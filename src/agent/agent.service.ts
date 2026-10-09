import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleGenAI } from '@google/genai';
import { AgentTools } from './agent-tools';
import { TRADING_ANALYST_PROMPT } from './prompts';
import { AiRecommendation } from '../database/entities/ai-recommendation.entity';

export interface ChatResponse {
  message: string;
  toolsUsed: string[];
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly client: GoogleGenAI;
  private readonly model: string;

  // In-memory session store: sessionId → last interaction ID
  private readonly sessions = new Map<string, string>();

  constructor(
    private readonly config: ConfigService,
    private readonly tools: AgentTools,
    @InjectRepository(AiRecommendation)
    private readonly recRepo: Repository<AiRecommendation>,
  ) {
    this.client = new GoogleGenAI({
      apiKey: config.get<string>('gemini.apiKey') || '',
    });
    this.model = config.get<string>('gemini.model') || 'gemini-3.8-flash';
  }

  /**
   * Send a message to the trading agent.
   * Resolves all tool calls in an agentic loop before returning the final answer.
   */
  async chat(userMessage: string, sessionId?: string): Promise<ChatResponse> {
    const toolsUsed: string[] = [];

    // Build tool list in the FunctionT format required by the interactions API
    const toolList = this.tools.getToolDeclarations().map((decl) => ({
      type: 'function' as const,
      name: decl.name,
      description: decl.description,
      parameters: decl.parameters,
    }));

    const prevInteractionId = sessionId ? this.sessions.get(sessionId) : undefined;

    try {
      // First turn
      let interaction = await this.client.interactions.create({
        model: this.model as any,
        system_instruction: TRADING_ANALYST_PROMPT,
        input: userMessage,
        tools: toolList as any,
        ...(prevInteractionId ? { previous_interaction_id: prevInteractionId } : {}),
        store: true,
      });

      // Agentic tool-call loop
      while (interaction.status === 'requires_action') {
        const functionCallSteps = (interaction.steps ?? []).filter(
          (s: any) => s.type === 'function_call',
        );
        if (!functionCallSteps.length) break;

        // Execute all pending tool calls
        const resultSteps: any[] = await Promise.all(
          functionCallSteps.map(async (step: any) => {
            const toolName: string = step.name ?? step.function_call?.name;
            const toolArgs = step.arguments ?? step.function_call?.arguments ?? {};
            toolsUsed.push(toolName);

            const result = await this.tools.callTool(toolName, toolArgs);
            return {
              type: 'function_result',
              call_id: step.id,
              name: toolName,
              result: JSON.stringify(result),
            };
          }),
        );

        // Submit tool results as the next turn's input (Step[])
        interaction = await this.client.interactions.create({
          model: this.model as any,
          system_instruction: TRADING_ANALYST_PROMPT,
          tools: toolList as any,
          previous_interaction_id: interaction.id,
          input: resultSteps as any,
          store: true,
        });
      }

      const responseText = interaction.output_text ?? 'No response generated.';

      if (sessionId) {
        this.sessions.set(sessionId, interaction.id);
      }

      this.logger.log(`Chat done. Tools: [${toolsUsed.join(', ')}]`);
      return { message: responseText, toolsUsed };
    } catch (err) {
      this.logger.error(`Agent error: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Stream a chat response (SSE).
   */
  async *chatStream(userMessage: string, sessionId?: string): AsyncGenerator<string> {
    const toolList = this.tools.getToolDeclarations().map((decl) => ({
      type: 'function' as const,
      name: decl.name,
      description: decl.description,
      parameters: decl.parameters,
    }));

    const prevInteractionId = sessionId ? this.sessions.get(sessionId) : undefined;

    const stream = await this.client.interactions.create({
      model: this.model as any,
      system_instruction: TRADING_ANALYST_PROMPT,
      input: userMessage,
      tools: toolList as any,
      ...(prevInteractionId ? { previous_interaction_id: prevInteractionId } : {}),
      store: true,
      stream: true,
    });

    for await (const event of stream as any) {
      if (event.event_type === 'step.delta' && event.delta?.type === 'text') {
        yield event.delta.text ?? '';
      } else if (event.event_type === 'interaction.completed' && sessionId) {
        this.sessions.set(sessionId, event.interaction?.id ?? '');
      }
    }
  }

  /** Generate a fresh market recommendation and persist it */
  async generateRecommendation(): Promise<AiRecommendation> {
    const response = await this.chat(
      'Analyse the current market and give me your top 5 swing trade setups. ' +
        'For each, provide entry zone, take profit target, stop loss, and clear rationale. ' +
        'Format as a structured list.',
    );

    const rec = this.recRepo.create({
      symbols: this.extractSymbols(response.message),
      reasoning: response.message,
      picks: [],
      confidence: 70,
      sessionId: null,
    });

    return this.recRepo.save(rec);
  }

  async getLatestRecommendations(limit = 5): Promise<AiRecommendation[]> {
    return this.recRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  private extractSymbols(text: string): string[] {
    const matches = text.match(/\b[A-Z]{2,10}USDT\b/g);
    return matches ? [...new Set(matches)] : [];
  }
}

