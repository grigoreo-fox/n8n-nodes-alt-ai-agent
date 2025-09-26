import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { assert, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';
import { SYSTEM_MESSAGE } from './prompts';
import { createAgentExecutor, getChatModel, getOptionalMemory, getTools, prepareMessages, preparePrompt } from './utils';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { omit } from 'lodash';

export class AltAiAgent implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Alt AI Agent',
		name: 'altAiAgent',
		icon: 'fa:robot',
		iconColor: 'black',
		group: ['transform'],
		description: 'Generates an action plan and executes it. Can use external tools.',
		defaults: {
			name: 'Alt Ai Agent',
			color: '#404040',
		},
		version: [1],
		inputs: [
			NodeConnectionTypes.Main,
			{
				type: NodeConnectionTypes.AiLanguageModel,
				displayName: 'Chat Model',
				required: true,
				maxConnections: 1,
			},
			{
				displayName: 'Memory',
				type: NodeConnectionTypes.AiMemory,
				maxConnections: 1,
			},
			{
				displayName: 'Tool',
				type: NodeConnectionTypes.AiTool,
			},
		],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'System Message',
				name: 'systemMessage',
				type: 'string',
				default: SYSTEM_MESSAGE,
				required: true,
				description: 'The message that will be sent to the agent before the conversation starts',
				typeOptions: {
					rows: 2,
				},
			},
			{
				displayName: 'Prompt (User Message)',
				name: 'text',
				type: 'string',
				required: true,
				default: '={{ $json.input }}',
				placeholder: 'e.g. Hello, how can you help me?',
				typeOptions: {
					rows: 2,
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				default: {
					saveToolCallsToMemory: true,
					returnIntermediateSteps: true,
					passthroughBinaryImages: true,
				},
				placeholder: 'Add Option',
				options: [
					{
						displayName: 'Max Iterations',
						name: 'maxIterations',
						type: 'number',
						default: 10,
						description: 'The maximum number of iterations the agent will run before stopping',
					},
					{
						displayName: 'Save Tool Calls to Memory',
						name: 'saveToolCallsToMemory',
						type: 'boolean',
						default: true,
						description: 'Whether or not the tool calls should be saved to memory',
					},
					{
						displayName: 'Return Intermediate Steps',
						name: 'returnIntermediateSteps',
						type: 'boolean',
						default: true,
						description: 'Whether or not the output should include intermediate steps the agent took',
					},
					{
						displayName: 'Automatically Passthrough Binary Images',
						name: 'passthroughBinaryImages',
						type: 'boolean',
						default: true,
						description:
							'Whether or not binary images should be automatically passed through to the agent as image type messages',
					},
				],
			},
		],
	};
	/* -----------------------------------------------------------
		Main Executor Function
	----------------------------------------------------------- */
	/**
	 * The main executor method for the Tools Agent.
	 *
	 * This function retrieves necessary components (model, memory, tools), prepares the prompt,
	 * creates the agent, and processes each input item. The error handling for each item is also
	 * managed here based on the node's continueOnFail setting.
	 *
	 * @param this Execute context. SupplyDataContext is passed when agent is as a tool
	 *
	 * @returns The array of execution data for all processed items
	 */
	async execute(
		this: IExecuteFunctions,
	): Promise<INodeExecutionData[][]> {
		this.logger.debug('Executing Alt AI Agent');

		const returnData: INodeExecutionData[] = [];
		const items = this.getInputData();
		const batchSize = this.getNodeParameter('options.batching.batchSize', 0, 1) as number; //TODO: implement batching

		const delayBetweenBatches = this.getNodeParameter(
			'options.batching.delayBetweenBatches',
			0,
			0,
		) as number;

		const memory = await getOptionalMemory(this);

		const model = await getChatModel(this, 0);
		assert(model, 'Please connect a model to the Chat Model input');


		// Check if streaming is enabled // TODO: implement streaming
		// const enableStreaming = this.getNodeParameter('options.enableStreaming', 0, false) as boolean; //TODO: implement streaming

		for (let i = 0; i < items.length; i += batchSize) {
			const batch = items.slice(i, i + batchSize);
			const batchPromises = batch.map(async (_item, batchItemIndex) => {
				const itemIndex = i + batchItemIndex;

				const input = this.getNodeParameter('text', itemIndex, '');
				if (input === undefined) {
					throw new NodeOperationError(this.getNode(), 'The "text" parameter is empty.');
				}
				// const outputParser = undefined; //TODO: implement output parser

				const tools = await getTools(this);
				const options = this.getNodeParameter('options', itemIndex, {}) as {
					systemMessage?: string;
					saveToolCallsToMemory?: boolean;
					maxIterations?: number;
					returnIntermediateSteps?: boolean;
					passthroughBinaryImages?: boolean;
				};

				// Prepare the prompt messages and prompt template.
				const messages = await prepareMessages(this, itemIndex, {
					systemMessage: options.systemMessage,
					passthroughBinaryImages: options.passthroughBinaryImages ?? true,
					// outputParser, // TODO implement parser
				});
				const prompt: ChatPromptTemplate = preparePrompt(messages);

				// Create executors for primary and fallback models
				const executor = createAgentExecutor(
					model,
					tools,
					prompt,
					options,
					// outputParser, // TODO implement parser
					memory
					// fallbackModel, // TODO implement fallback model
				);

				// Invoke with fallback logic
				const invokeParams = {
					input,
					system_message: options.systemMessage ?? SYSTEM_MESSAGE,
					formatting_instructions:
						'IMPORTANT: For your response to user, you MUST use the `format_final_json_response` tool with your complete answer formatted according to the required schema. Do not attempt to format the JSON manually - always use this tool. Your response will be rejected if it is not properly formatted through this tool. Only use this tool once you are ready to provide your final answer.',
				};
				const executeOptions = { signal: this.getExecutionCancelSignal() };

				// Check if streaming is actually available
				// const isStreamingAvailable = 'isStreaming' in this ? this.isStreaming?.() : undefined;

				// 	if ( // TODO implement streaming
				// 		'isStreaming' in this &&
				// 		enableStreaming &&
				// 		isStreamingAvailable &&
				// 		this.getNode().typeVersion >= 2.1
				// 	) {
				// 		// Get chat history respecting the context window length configured in memory
				// 		let chatHistory;
				// 		if (memory) {
				// 			// Load memory variables to respect context window length
				// 			const memoryVariables = await memory.loadMemoryVariables({});
				// 			chatHistory = memoryVariables['chat_history'];
				// 		}
				// 		const eventStream = executor.streamEvents(
				// 			{
				// 				...invokeParams,
				// 				chat_history: chatHistory ?? undefined,
				// 			},
				// 			{
				// 				version: 'v2',
				// 				...executeOptions,
				// 			},
				// 		);

				// 		return await processEventStream(
				// 			this,
				// 			eventStream,
				// 			itemIndex,
				// 			options.returnIntermediateSteps,
				// 		);
				// 	} else {
				// 		// Handle regular execution
				// 		return await executor.invoke(invokeParams, executeOptions);
				// 	}
				let response;
				try {
					response = await executor.invoke(invokeParams, executeOptions);
				} catch (error) {
					console.error('error', error);
					throw error;
				}
				return response;
			});

			const batchResults = await Promise.allSettled(batchPromises);
			// This is only used to check if the output parser is connected
			// so we can parse the output if needed. Actual output parsing is done in the loop above
			// const outputParser = await getOptionalOutputParser(this, 0);

			batchResults.forEach((result, index) => {
				const itemIndex = i + index;
				if (result.status === 'rejected') {
					const error = result.reason as Error;
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: error.message },
							pairedItem: { item: itemIndex },
						});
						return;
					} else {
						throw new NodeOperationError(this.getNode(), error);
					}
				}
				const response = result.value;
				// If memory and outputParser are connected, parse the output.
				// if (memory && outputParser) { // TODO implement parser
				// 	const parsedOutput = jsonParse<{ output: Record<string, unknown> }>(
				// 		response.output as string,
				// 	);
				// 	response.output = parsedOutput?.output ?? parsedOutput;
				// }

				// Omit internal keys before returning the result.
				const itemResult = {
					json: omit(
						response,
						'system_message',
						'formatting_instructions',
						'input',
						'chat_history',
						'agent_scratchpad',
					),
					pairedItem: { item: itemIndex },
				};

				returnData.push(itemResult);
			});

			if (i + batchSize < items.length && delayBetweenBatches > 0) {
				await sleep(delayBetweenBatches);
			}
		}

		return [returnData];
	}

}
