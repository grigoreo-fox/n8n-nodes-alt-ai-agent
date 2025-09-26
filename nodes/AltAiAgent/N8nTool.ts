/* eslint-disable @typescript-eslint/no-explicit-any */
// Keep API identical: same exports/types/class names & method signatures.
import type { DynamicStructuredToolInput } from '@langchain/core/tools';
import { DynamicStructuredTool, DynamicTool } from '@langchain/core/tools';
// ⬇️ Remove StructuredOutputParser (heavy generics/types)
// import { StructuredOutputParser } from 'langchain/output_parsers';

import type { ISupplyDataFunctions, IDataObject } from 'n8n-workflow';
import { NodeConnectionTypes, jsonParse, NodeOperationError } from 'n8n-workflow';

// Import Zod as *types only* to avoid pulling class types into the checker
import type { z, ZodTypeAny } from 'zod';

type ZodObjectAny = z.ZodObject<any, any, any, any>;

// Lightweight type inspection without importing Zod classes at value level
function baseTypeName(s: ZodTypeAny): string {
  // Peel wrappers (Optional / Nullable) iteratively via _def.innerType
  // to keep TS simple and avoid value-class imports.
  let cur: any = s as any;
  // limit iterations to avoid pathological chains
  for (let i = 0; i < 6; i++) {
    const t = cur?._def?.typeName as string | undefined;
    if (t === 'ZodOptional' || t === 'ZodNullable' || t === 'ZodDefault' || t === 'ZodEffects') {
      cur = cur?._def?.innerType ?? cur?._def?.schema ?? cur;
      continue;
    }
    return t ?? 'ZodUnknown';
  }
  return 'ZodUnknown';
}

const getSimplifiedType = (schema: ZodTypeAny) => {
  switch (baseTypeName(schema)) {
    case 'ZodObject':
      return 'object';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodString':
      return 'string';
    case 'ZodArray':
      return 'array';
    case 'ZodEnum':
      return 'enum';
    default:
      return 'string';
  }
};

const getParametersDescription = (parameters: Array<[string, ZodTypeAny]>) =>
  parameters
    .map(
      ([name, schema]) =>
        `${name}: (description: ${(schema as any).description ?? ''}, type: ${getSimplifiedType(schema)}, required: ${!schema.isOptional()})`,
    )
    .join(',\n ');

export const prepareFallbackToolDescription = (toolDescription: string, schema: ZodObjectAny) => {
  let description = `${toolDescription}`;

  const toolParameters = Object.entries<ZodTypeAny>(schema.shape);

  if (toolParameters.length) {
    description += `
Tool expects valid stringified JSON object with ${toolParameters.length} properties.
Property names with description, type and required status:
${getParametersDescription(toolParameters)}
ALL parameters marked as required must be provided`;
  }

  return description;
};

export class N8nTool extends DynamicStructuredTool<ZodObjectAny> { //@ts-expect-error - ignore TypeScript error for this line
  constructor(
    private context: ISupplyDataFunctions,
    fields: DynamicStructuredToolInput<ZodObjectAny>,
  ) {
    super(fields);
  }

  asDynamicTool(): DynamicTool {
    const { name, func, schema, context, description } = this;

    // ⬇️ Replace StructuredOutputParser with lightweight validation
    const wrappedFunc = async (query: string) => {
      let parsedQuery: unknown;

      // 1) Try to read relaxed JSON first (accepts JS-like)
      try {
        parsedQuery = jsonParse<IDataObject>(query, { acceptJSObject: true });
      } catch (jsonErr: any) {
        // 2) If a single-parameter tool, treat raw string as that param
        const keys = Object.keys(schema.shape);
        if (keys.length === 1) {
          parsedQuery = { [keys[0]]: query };
        } else {
          throw new NodeOperationError(
            context.getNode(),
            `Input is not a valid JSON: ${jsonErr?.message ?? String(jsonErr)}`,
          );
        }
      }

      // 3) Validate against Zod schema (strict); let Zod craft the error
      const result = schema.safeParse(parsedQuery);
      if (!result.success) {
        // Keep the original feel of your error messages but much faster to type-check
        throw new NodeOperationError(
          context.getNode(),
          `Input does not match schema: ${result.error.message}`,
        );
      }

      try {
        // 4) Call underlying tool
        const out = await func(result.data as any);
        return out;
      } catch (e) {
        const { index } = context.addInputData(NodeConnectionTypes.AiTool, [[{ json: { query } }]]);
        void context.addOutputData(NodeConnectionTypes.AiTool, index, e);
        return String(e);
      }
    };

    return new DynamicTool({
      name,
      description: prepareFallbackToolDescription(description, schema),
      func: wrappedFunc,
    });
  }
}
