import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { IsString, IsOptional } from 'class-validator';
import { AgentService } from '../../agent/agent.service';

class ChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  stream?: boolean;
}

@Controller('agent')
export class AgentApiController {
  constructor(private readonly agentService: AgentService) {}

  /**
   * POST /api/agent/chat
   * Body: { message: string, sessionId?: string, stream?: boolean }
   *
   * If stream=true, returns Server-Sent Events text stream.
   * Otherwise returns JSON response.
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async chat(@Body() dto: ChatDto, @Res() res: Response) {
    if (dto.stream) {
      // Server-Sent Events streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      try {
        const gen = this.agentService.chatStream(dto.message, dto.sessionId);
        for await (const chunk of gen) {
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      } finally {
        res.end();
      }
    } else {
      // Standard JSON response
      const response = await this.agentService.chat(dto.message, dto.sessionId);
      return res.json(response);
    }
  }

  /** GET /api/agent/recommendations — latest AI picks */
  @Get('recommendations')
  async getRecommendations(@Query('limit') limit = '5') {
    return this.agentService.getLatestRecommendations(parseInt(limit, 10));
  }

  /** POST /api/agent/analyze — trigger a fresh market analysis */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyze() {
    const rec = await this.agentService.generateRecommendation();
    return rec;
  }
}

