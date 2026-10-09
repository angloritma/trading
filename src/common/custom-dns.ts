import { Resolver } from 'dns';
import { LookupFunction } from 'net';
import { Logger } from '@nestjs/common';

/**
 * Custom DNS lookup that bypasses the OS/ISP resolver.
 *
 * Some ISPs (e.g. Indonesia's "Internet Positif" filter) hijack DNS for
 * crypto-exchange domains, returning a block page with an invalid TLS cert.
 * Resolving via public DNS (Cloudflare / Google) returns the real IPs.
 *
 * Configure with env DNS_SERVERS="1.1.1.1,8.8.8.8" (default).
 * Set DNS_SERVERS="system" to use the OS resolver instead.
 */
const logger = new Logger('CustomDns');

const servers = (process.env.DNS_SERVERS || '1.1.1.1,8.8.8.8')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const useSystem = servers.length === 1 && servers[0] === 'system';

const resolver = new Resolver();
if (!useSystem) resolver.setServers(servers);

/** Simple in-memory cache: host -> { ips, expires } */
const cache = new Map<string, { ips: string[]; expires: number }>();
const TTL_MS = 5 * 60 * 1_000;

export const customLookup: LookupFunction | undefined = useSystem
  ? undefined
  : (hostname, options, callback) => {
      const cb = callback as any;
      const wantAll = typeof options === 'object' && (options as any)?.all;

      const respond = (ips: string[]) => {
        const ip = ips[Math.floor(Math.random() * ips.length)];
        if (wantAll) cb(null, ips.map((address) => ({ address, family: 4 })));
        else cb(null, ip, 4);
      };

      const cached = cache.get(hostname);
      if (cached && cached.expires > Date.now()) return respond(cached.ips);

      resolver.resolve4(hostname, (err, ips) => {
        if (err || !ips?.length) {
          logger.warn(`DNS resolve failed for ${hostname} via ${servers.join(',')}: ${err?.message}`);
          return cb(err || new Error(`No A records for ${hostname}`));
        }
        cache.set(hostname, { ips, expires: Date.now() + TTL_MS });
        respond(ips);
      });
    };
