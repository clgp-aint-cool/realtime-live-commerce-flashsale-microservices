import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { InternalGuard } from '../common/internal.guard';
import { LivesService } from './lives.service';

@Controller('api/lives')
export class LivesController {
  constructor(private readonly lives: LivesService) {}

  @Get()
  list() {
    return this.lives.list();
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.lives.detail(id);
  }
}

@Controller('internal')
@UseGuards(InternalGuard)
export class InternalController {
  constructor(private readonly lives: LivesService) {}

  @Get('channels/open-session')
  openSession(@Query('channelArn') channelArn?: string) {
    if (!channelArn) throw new BadRequestException('Thiếu channelArn');
    return this.lives.openSessionByChannel(channelArn);
  }
}
