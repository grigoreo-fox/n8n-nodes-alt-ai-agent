// toolAwareMemory.ts
import type { BaseChatMemory } from "langchain/memory";
import type { InputValues, OutputValues } from "@langchain/core/memory";
import type { AgentStep } from "langchain/agents";

type Position = "prepend" | "append" | "replace";

export type ToolFoldOptions = {
  position?: Position;          // default: "prepend"
  joiner?: string;              // default: "\n\n"
  maxObservationLen?: number;   // default: 2000
  includeTools?: readonly string[];
  excludeTools?: readonly string[];
};

/* ---------- helpers ---------- */
function fmtArgs(args: unknown): string {
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return String(args);
  }
}

function fmtObs(obs: unknown, maxLen: number): string {
  const raw =
    typeof obs === "string"
      ? obs
      : (() => {
          try {
            return JSON.stringify(obs);
          } catch {
            return String(obs);
          }
        })();
  return raw.length > maxLen ? raw.slice(0, maxLen) + " …[truncated]" : raw;
}

function buildToolSummary(
  steps: readonly AgentStep[],
  maxObservationLen: number
): string {
  if (steps.length === 0) return "";
  const lines = steps.map((s) => {
    const name = s.action.tool;
    const args = fmtArgs(s.action.toolInput);
    const obs = fmtObs(s.observation, maxObservationLen);
    return `tool call: ${name}(${args}) => ${obs}`;
  });
  return lines.join("\n\n");
}

/* ---------- main wrapper ---------- */

/**
 * Intercepts only saveContext:
 * - folds tool calls into outputs[outputKey]
 * - calls the original saveContext (so log wrappers keep working)
 */
export function makeToolAware<T extends BaseChatMemory>(
  memory: T,
  options?: ToolFoldOptions
): T {
  const joiner = options?.joiner ?? "\n\n";
  const maxObservationLen = options?.maxObservationLen ?? 4000;

  const proxy = new Proxy(memory, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === "saveContext" && typeof value === "function") {
        return async (inputs: InputValues, outputs: OutputValues): Promise<void> => {
          const outputKey = (target as { outputKey?: string }).outputKey ?? "output";

          // Read existing AI text (if any)
          const aiText = outputs[outputKey] ?? "";

          // Build tool summary
          const steps = outputs?.intermediateSteps?.filter((s: AgentStep) => s?.action?.tool) as readonly AgentStep[];
          const toolSummary = buildToolSummary(steps, maxObservationLen);

          // If no tool summary, pass through unchanged
          if (!toolSummary) {
            return (value as (i: InputValues, o: OutputValues) => Promise<void>)(inputs, outputs);
          }

          // Compose final assistant text
          const composed = toolSummary + joiner + aiText;

          // Clone outputs and inject composed text under outputKey
          const editedOutputs: OutputValues = {
            ...(outputs as Record<string, unknown>),
            [outputKey]: composed,
          };

          // Call original saveContext with modified outputs
          return (value as (i: InputValues, o: OutputValues) => Promise<void>)(
            inputs,
            editedOutputs
          );
        };
      }

      // Everything else proxied untouched
      return value;
    },
  });

  return proxy as T;
}
