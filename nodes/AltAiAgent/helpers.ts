import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseLLM } from "@langchain/core/language_models/llms";
import type { Tool } from '@langchain/core/tools';
// eslint-disable-next-line import-x/no-unresolved
import { Toolkit } from 'langchain/agents';
import { IExecuteFunctions, ISupplyDataFunctions, IWebhookFunctions, NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import { N8nTool } from "./N8nTool";

export function isChatInstance(model: unknown): model is BaseChatModel {
	const namespace = (model as BaseLLM)?.lc_namespace ?? [];

	return namespace.includes('chat_models');
}


export function escapeSingleCurlyBrackets(text?: string): string | undefined {
	if (text === undefined) return undefined;

	let result = text;

	result = result
		// First handle triple brackets to avoid interference with double brackets
		.replace(/(?<!{){{{(?!{)/g, '{{{{')
		.replace(/(?<!})}}}(?!})/g, '}}}}')
		// Then handle single brackets, but only if they're not part of double brackets
		// Convert single { to {{ if it's not already part of {{ or {{{
		.replace(/(?<!{){(?!{)/g, '{{')
		// Convert single } to }} if it's not already part of }} or }}}
		.replace(/(?<!})}(?!})/g, '}}');

	return result;
}


export const getConnectedTools = async (
	ctx: IExecuteFunctions | IWebhookFunctions | ISupplyDataFunctions,
	enforceUniqueNames: boolean,
	convertStructuredTool: boolean = true,
	escapeCurlyBrackets: boolean = false,
) => {
	const connectedTools = (
		((await ctx.getInputConnectionData(NodeConnectionTypes.AiTool, 0)) as Array<Toolkit | Tool>) ??
		[]
	).flatMap((toolOrToolkit) => {
		if (toolOrToolkit instanceof Toolkit) {
			return toolOrToolkit.getTools() as Tool[];
		}

		return toolOrToolkit;
	});

	if (!enforceUniqueNames) return connectedTools;

	const seenNames = new Set<string>();

	const finalTools: Tool[] = [];

	for (const tool of connectedTools) {
		const { name } = tool;
		if (seenNames.has(name)) {
			throw new NodeOperationError(
				ctx.getNode(),
				`You have multiple tools with the same name: '${name}', please rename them to avoid conflicts`,
			);
		}
		seenNames.add(name);

		if (escapeCurlyBrackets) {
			tool.description = escapeSingleCurlyBrackets(tool.description) ?? tool.description;
		}

		if (convertStructuredTool && tool instanceof N8nTool) {
			// @ts-expect-error - ignore TypeScript error for this line
			finalTools.push(tool.asDynamicTool());
		} else {
			finalTools.push(tool);
		}
	}

	return finalTools;
};