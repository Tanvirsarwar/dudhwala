import { Controller, Get, Inject, Param } from '@nestjs/common';
import { Public } from '../access/decorators.js';
import { notFound } from '../common/errors.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Policy and information pages (About, FAQ, delivery policy, terms, refund policy, privacy).
 * The TEXT is supplied by the owner in the setup file; none is written here. With no pages configured,
 * the storefront simply shows no page links.
 */
@Controller('content')
export class ContentController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get('home')
  @Public()
  async home() {
    const pages = await this.settings.get('content.pages');
    return { banners: [], collections: [], pages: pages.map((p) => ({ slug: p.slug, titleBn: p.titleBn })), maintenance: await this.settings.get('site.maintenance') };
  }

  @Get('pages/:slug')
  @Public()
  async page(@Param('slug') slug: string) {
    const p = (await this.settings.get('content.pages')).find((x) => x.slug === slug);
    if (!p) throw notFound('Page');
    return p;
  }
}
