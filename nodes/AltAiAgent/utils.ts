import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BINARY_ENCODING, IExecuteFunctions, ISupplyDataFunctions, NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import type { BaseChatMemory } from 'langchain/memory';
import { getConnectedTools, isChatInstance } from './helpers';
import { DynamicStructuredTool, Tool } from '@langchain/core/tools';
import { BaseMessagePromptTemplateLike, ChatPromptTemplate } from '@langchain/core/prompts';
import { AIMessageChunk, BaseMessage, HumanMessage, MessageContentText } from '@langchain/core/messages';
import { AgentExecutor, AgentFinish, AgentRunnableSequence, createToolCallingAgent } from 'langchain/agents';
import { RunnableSequence } from '@langchain/core/runnables';
import type { ToolsAgentAction } from 'langchain/dist/agents/tool_calling/output_parser';
import { IterableReadableStream } from '@langchain/core/utils/stream';
import type { StreamEvent } from '@langchain/core/dist/tracers/event_stream';
import { makeToolAware } from './toolAwareMemory';

/**
 * Retrieves the memory instance from the input connection if it is connected
 *
 * @param ctx - The execution context
 * @returns The connected memory (if any)
 */
export async function getOptionalMemory(
	ctx: IExecuteFunctions,
): Promise<BaseChatMemory | undefined> {
	return (await ctx.getInputConnectionData(NodeConnectionTypes.AiMemory, 0)) as
		| BaseChatMemory
		| undefined;
}

/**
 * Retrieves the language model from the input connection.
 * Throws an error if the model is not a valid chat instance or does not support tools.
 *
 * @param ctx - The execution context
 * @returns The validated chat model
 */
export async function getChatModel(
	ctx: IExecuteFunctions | ISupplyDataFunctions,
	index: number = 0,
): Promise<BaseChatModel | undefined> {
	const connectedModels = await ctx.getInputConnectionData(NodeConnectionTypes.AiLanguageModel, 0);

	let model;

	if (Array.isArray(connectedModels) && index !== undefined) {
		if (connectedModels.length <= index) {
			return undefined;
		}
		// We get the models in reversed order from the workflow so we need to reverse them to match the right index
		const reversedModels = [...connectedModels].reverse();
		model = reversedModels[index] as BaseChatModel;
	} else {
		model = connectedModels as BaseChatModel;
	}

	if (!isChatInstance(model) || !model.bindTools) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Tools Agent requires Chat Model which supports Tools calling',
		);
	}
	return model;
}


/**
 * Retrieves the connected tools and (if an output parser is defined)
 * appends a structured output parser tool.
 *
 * @param ctx - The execution context
 * @param outputParser - The optional output parser
 * @returns The array of connected tools
 */
export async function getTools(
	ctx: IExecuteFunctions | ISupplyDataFunctions,
	// outputParser?: N8nOutputParser, //TODO implement Parser
): Promise<Array<DynamicStructuredTool | Tool>> {
	const tools = (await getConnectedTools(ctx, true, false)) as Array<DynamicStructuredTool | Tool>;

	// If an output parser is available, create a dynamic tool to validate the final output.
	// if (outputParser) { // TODO implement Parser
	// 	const schema = getOutputParserSchema(outputParser);
	// 	const structuredOutputParserTool = new DynamicStructuredTool({
	// 		schema,
	// 		name: 'format_final_json_response',
	// 		description:
	// 			'Use this tool to format your final response to the user in a structured JSON format. This tool validates your output against a schema to ensure it meets the required format. ONLY use this tool when you have completed all necessary reasoning and are ready to provide your final answer. Do not use this tool for intermediate steps or for asking questions. The output from this tool will be directly returned to the user.',
	// 		// We do not use a function here because we intercept the output with the parser.
	// 		func: async () => '',
	// 	});
	// 	tools.push(structuredOutputParserTool);
	// }
	return tools;
}


/**
 * Prepares the prompt messages for the agent.
 *
 * @param ctx - The execution context
 * @param itemIndex - The current item index
 * @param options - Options containing systemMessage and other parameters
 * @returns The array of prompt messages
 */
export async function prepareMessages(
	ctx: IExecuteFunctions | ISupplyDataFunctions,
	itemIndex: number,
	options: {
		systemMessage?: string;
		passthroughBinaryImages?: boolean;
		// outputParser?: N8nOutputParser; // TODO implement parser
	},
): Promise<BaseMessagePromptTemplateLike[]> {
	const useSystemMessage = options.systemMessage ?? ctx.getNode().typeVersion < 1.9;

	const messages: BaseMessagePromptTemplateLike[] = [];

	if (useSystemMessage) {
		messages.push([
			'system',
			// `{system_message}${options.outputParser ? '\n\n{formatting_instructions}' : ''}`, // TODO implement parser
			`{system_message}`,
		]);
	} 
	// else if (options.outputParser) { // TODO implement parser
	// 	messages.push(['system', '{formatting_instructions}']);
	// }

	messages.push(['placeholder', '{chat_history}'], ['human', '{input}']);

	// If there is binary data and the node option permits it, add a binary message
	const hasBinaryData = ctx.getInputData()?.[itemIndex]?.binary !== undefined;
	if (hasBinaryData && options.passthroughBinaryImages) {
		const binaryMessage = await extractBinaryMessages(ctx, itemIndex);
		if (binaryMessage.content.length !== 0) {
			messages.push(binaryMessage);
		} else {
			ctx.logger.debug('Not attaching binary message, since its content was empty');
		}
	}

	// We add the agent scratchpad last, so that the agent will not run in loops
	// by adding binary messages between each interaction
	messages.push(['placeholder', '{agent_scratchpad}']);
	return messages;
}


/* -----------------------------------------------------------
   Binary Data Helpers
----------------------------------------------------------- */
/**
 * Extracts binary image messages from the input data.
 * When operating in filesystem mode, the binary stream is first converted to a buffer.
 *
 * @param ctx - The execution context
 * @param itemIndex - The current item index
 * @returns A HumanMessage containing the binary image messages.
 */
export async function extractBinaryMessages(
	ctx: IExecuteFunctions | ISupplyDataFunctions,
	itemIndex: number,
): Promise<HumanMessage> {
	const binaryData = ctx.getInputData()?.[itemIndex]?.binary ?? {};
	const binaryMessages = await Promise.all(
		Object.values(binaryData)
			.filter((data) => data.mimeType.startsWith('image/'))
			.map(async (data) => {
				let binaryUrlString: string;

				// In filesystem mode we need to get binary stream by id before converting it to buffer
				if (data.id) {
					const binaryBuffer = await ctx.helpers.binaryToBuffer(
						await ctx.helpers.getBinaryStream(data.id),
					);
					binaryUrlString = `data:${data.mimeType};base64,${Buffer.from(binaryBuffer).toString(
						BINARY_ENCODING,
					)}`;
				} else {
					binaryUrlString = data.data.includes('base64')
						? data.data
						: `data:${data.mimeType};base64,${data.data}`;
				}

				return {
					type: 'image_url',
					image_url: {
						url: binaryUrlString,
					},
				};
			}),
	);
	return new HumanMessage({
		content: [...binaryMessages],
	});
}



/**
 * Creates the chat prompt from messages.
 *
 * @param messages - The messages array
 * @returns The ChatPromptTemplate instance
 */
export function preparePrompt(messages: BaseMessagePromptTemplateLike[]): ChatPromptTemplate {
	return ChatPromptTemplate.fromMessages(messages);
}

/**
 * Fixes empty content messages in agent steps.
 *
 * This function is necessary when using RunnableSequence.from in LangChain.
 * If a tool doesn't have any arguments, LangChain returns input: '' (empty string).
 * This can throw an error for some providers (like Anthropic) which expect the input to always be an object.
 * This function replaces empty string inputs with empty objects to prevent such errors.
 *
 * @param steps - The agent steps to fix
 * @returns The fixed agent steps
 */
export function fixEmptyContentMessage(
	steps: AgentFinish | ToolsAgentAction[],
): AgentFinish | ToolsAgentAction[] {
	if (!Array.isArray(steps)) return steps;

	steps.forEach((step) => {
		if ('messageLog' in step && step.messageLog !== undefined) {
			if (Array.isArray(step.messageLog)) {
				step.messageLog.forEach((message: BaseMessage) => {
					if ('content' in message && Array.isArray(message.content)) {
						(message.content as Array<{ input?: string | object }>).forEach((content) => {
							if (content.input === '') {
								content.input = {};
							}
						});
					}
				});
			}
		}
	});

	return steps;
}


/**
 * Creates an agent executor with the given configuration
 */
export function createAgentExecutor(
	model: BaseChatModel,
	tools: Array<DynamicStructuredTool | Tool>,
	prompt: ChatPromptTemplate,
	options: {
		saveToolCallsToMemory?: boolean;
		maxIterations?: number;
		returnIntermediateSteps?: boolean 
},
	// outputParser?: N8nOutputParser, // TODO implement parser
	memory?: BaseChatMemory,
	fallbackModel?: BaseChatModel | null,
) {
	const agent = createToolCallingAgent({
		llm: model,
		tools,
		prompt,
		streamRunnable: false,
	});

	let fallbackAgent: AgentRunnableSequence | undefined;
	if (fallbackModel) {
		fallbackAgent = createToolCallingAgent({
			llm: fallbackModel,
			tools,
			prompt,
			streamRunnable: false,
		});
	}
	const runnableAgent = RunnableSequence.from([
		fallbackAgent ? agent.withFallbacks([fallbackAgent]) : agent,
		// getAgentStepsParser(outputParser, memory),
		fixEmptyContentMessage,
	]) as AgentRunnableSequence;

	runnableAgent.singleAction = false;
	runnableAgent.streamRunnable = false;

	return AgentExecutor.fromAgentAndTools({
		agent: runnableAgent,
		memory: memory && options.saveToolCallsToMemory ? makeToolAware(memory) : memory,
		tools,
		returnIntermediateSteps: options.returnIntermediateSteps === true,
		maxIterations: options.maxIterations ?? 10,
	});
}


export async function processEventStream(
	ctx: IExecuteFunctions,
	eventStream: IterableReadableStream<StreamEvent>,
	itemIndex: number,
	returnIntermediateSteps: boolean = false,
): Promise<{ output: string; intermediateSteps?: any[] }> { // eslint-disable-line @typescript-eslint/no-explicit-any
	const agentResult: { output: string; intermediateSteps?: any[] } = { // eslint-disable-line @typescript-eslint/no-explicit-any
		output: '',
	};

	if (returnIntermediateSteps) {
		agentResult.intermediateSteps = [];
	}

	ctx.sendChunk('begin', itemIndex);
	for await (const event of eventStream) {
		// Stream chat model tokens as they come in
		switch (event.event) {
			case 'on_chat_model_stream':
				{ const chunk = event.data?.chunk as AIMessageChunk;
				if (chunk?.content) {
					const chunkContent = chunk.content;
					let chunkText = '';
					if (Array.isArray(chunkContent)) {
						for (const message of chunkContent) {
							if (message?.type === 'text') {
								chunkText += (message as MessageContentText)?.text;
							}
						}
					} else if (typeof chunkContent === 'string') {
						chunkText = chunkContent;
					}
					ctx.sendChunk('item', itemIndex, chunkText);

					agentResult.output += chunkText;
				}
				break; }
			case 'on_chat_model_end':
				// Capture full LLM response with tool calls for intermediate steps
				if (returnIntermediateSteps && event.data) {
					const chatModelData = event.data as any; // eslint-disable-line @typescript-eslint/no-explicit-any
					const output = chatModelData.output;

					// Check if this LLM response contains tool calls
					if (output?.tool_calls && output.tool_calls.length > 0) {
						for (const toolCall of output.tool_calls) {
							agentResult.intermediateSteps!.push({
								action: {
									tool: toolCall.name,
									toolInput: toolCall.args,
									log:
										output.content ||
										`Calling ${toolCall.name} with input: ${JSON.stringify(toolCall.args)}`,
									messageLog: [output], // Include the full LLM response
									toolCallId: toolCall.id,
									type: toolCall.type,
								},
							});
						}
					}
				}
				break;
			case 'on_tool_end':
				// Capture tool execution results and match with action
				if (returnIntermediateSteps && event.data && agentResult.intermediateSteps!.length > 0) {
					const toolData = event.data as any; // eslint-disable-line @typescript-eslint/no-explicit-any
					// Find the matching intermediate step for this tool call
					const matchingStep = agentResult.intermediateSteps!.find(
						(step) => !step.observation && step.action.tool === event.name,
					);
					if (matchingStep) {
						matchingStep.observation = toolData.output;
					}
				}
				break;
			default:
				break;
		}
	}
	ctx.sendChunk('end', itemIndex);

	return agentResult;
}
