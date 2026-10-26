import { describe, it, expect } from 'vitest';
import {
  evaluateConnectedAddress,
  evaluateResolvedAddresses,
  isForbiddenTab,
  isPrivateIpAddress,
  parseDnsJsonAddresses,
  parseIPv4Address,
  parseIPv6Address
} from '../lib/background-utils.js';

// A public name can resolve to a private address (127.0.0.1.nip.io), so the
// hostname filter alone is not a boundary. These tests cover the address
// classifier the resolved-IP and connected-IP checks are built on.

describe('parseIPv4Address', () => {
  it('parses dotted-quad addresses', () => {
    expect(parseIPv4Address('127.0.0.1')).toBe(0x7f000001);
    expect(parseIPv4Address('255.255.255.255')).toBe(0xffffffff);
  });

  it('parses the inet_aton forms browsers and resolvers accept', () => {
    expect(parseIPv4Address('2130706433')).toBe(0x7f000001); // decimal
    expect(parseIPv4Address('0x7f000001')).toBe(0x7f000001); // hex
    expect(parseIPv4Address('0177.0.0.1')).toBe(0x7f000001); // octal part
    expect(parseIPv4Address('0x7f.1')).toBe(0x7f000001);     // short form
    expect(parseIPv4Address('127.1')).toBe(0x7f000001);
    expect(parseIPv4Address('10.1.258')).toBe(0x0a010102);
  });

  it('accepts a trailing root dot', () => {
    expect(parseIPv4Address('127.0.0.1.')).toBe(0x7f000001);
  });

  it('rejects anything that is not an address', () => {
    expect(parseIPv4Address('example.com')).toBeNull();
    expect(parseIPv4Address('256.0.0.1')).toBeNull();
    expect(parseIPv4Address('1.2.3.4.5')).toBeNull();
    expect(parseIPv4Address('08.0.0.1')).toBeNull(); // invalid octal
    expect(parseIPv4Address('')).toBeNull();
    expect(parseIPv4Address('1..2')).toBeNull();
    expect(parseIPv4Address('4294967296')).toBeNull();
  });
});

describe('parseIPv6Address', () => {
  it('expands compressed forms', () => {
    expect(parseIPv6Address('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6Address('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6Address('2606:4700::1111')).toEqual([0x2606, 0x4700, 0, 0, 0, 0, 0, 0x1111]);
  });

  it('accepts brackets, zone ids and an embedded IPv4 tail', () => {
    expect(parseIPv6Address('[::1]')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6Address('fe80::1%en0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6Address('[::ffff:127.0.0.1]')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  });

  it('rejects malformed input', () => {
    expect(parseIPv6Address('1::2::3')).toBeNull();
    expect(parseIPv6Address('12345::')).toBeNull();
    expect(parseIPv6Address('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(parseIPv6Address('example.com')).toBeNull();
    expect(parseIPv6Address('1:2:3:4:5:6:7')).toBeNull();
  });
});

describe('isPrivateIpAddress: IPv4', () => {
  it('allows public addresses', () => {
    for (const ip of ['93.184.215.14', '1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.0.1']) {
      expect(isPrivateIpAddress(ip), ip).toBe(false);
    }
  });

  it('refuses loopback, this-network and unspecified', () => {
    for (const ip of ['127.0.0.1', '127.255.255.254', '0.0.0.0', '0.1.2.3']) {
      expect(isPrivateIpAddress(ip), ip).toBe(true);
    }
  });

  it('refuses RFC1918, CGNAT and link-local', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '100.127.255.255', '169.254.169.254']) {
      expect(isPrivateIpAddress(ip), ip).toBe(true);
    }
  });

  it('refuses the other non-global special-purpose ranges', () => {
    for (const ip of [
      '192.0.0.8',      // IETF protocol assignments
      '192.0.2.1',      // TEST-NET-1
      '198.18.0.1',     // benchmarking
      '198.51.100.1',   // TEST-NET-2
      '203.0.113.1',    // TEST-NET-3
      '224.0.0.1',      // multicast
      '240.0.0.1',      // reserved
      '255.255.255.255' // broadcast
    ]) {
      expect(isPrivateIpAddress(ip), ip).toBe(true);
    }
  });

  it('classifies decimal, octal, hex and trailing-dot forms by value', () => {
    for (const ip of ['2130706433', '0177.0.0.1', '0x7f.0.0.1', '0x7f000001', '127.1', '127.0.0.1.', '012.0.0.1']) {
      expect(isPrivateIpAddress(ip), ip).toBe(true);
    }
  });
});

describe('isPrivateIpAddress: IPv6', () => {
  it('allows global unicast', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '[2a00:1450::1]']) {
      expect(isPrivateIpAddress(ip), ip).toBe(false);
    }
  });

  it('refuses loopback, unspecified, ULA, link-local, site-local and multicast', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%en0', 'febf::1', 'fec0::1', 'ff02::1']) {
      expect(isPrivateIpAddress(ip), ip).toBe(true);
    }
  });

  it('classifies IPv4-mapped and IPv4-embedding forms by the embedded address', () => {
    expect(isPrivateIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIpAddress('[::ffff:127.0.0.1]')).toBe(true);
    expect(isPrivateIpAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIpAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIpAddress('::127.0.0.1')).toBe(true);        // IPv4-compatible
    expect(isPrivateIpAddress('64:ff9b::7f00:1')).toBe(true);    // NAT64 of loopback
    expect(isPrivateIpAddress('2002:7f00:1::1')).toBe(true);     // 6to4 of loopback
    expect(isPrivateIpAddress('2002:c0a8:101::1')).toBe(true);   // 6to4 of 192.168.1.1
    expect(isPrivateIpAddress('::ffff:93.184.215.14')).toBe(false);
    expect(isPrivateIpAddress('64:ff9b::5db8:d70e')).toBe(false);
  });

  it('refuses documentation, Teredo and other non-global space', () => {
    for (const ip of ['2001:db8::1', '2001::1', '100::1', '3fff::1', '5f00::1']) {
      expect(isPrivateIpAddress(ip), ip).toBe(true);
    }
  });
});

describe('isPrivateIpAddress fails closed', () => {
  it('treats unparseable or empty input as private', () => {
    for (const value of ['', null, undefined, 'not-an-ip', '1.2.3.4.5', '::g']) {
      expect(isPrivateIpAddress(value), String(value)).toBe(true);
    }
  });
});

describe('isForbiddenTab with IP-literal hosts', () => {
  const forbid = (url) => isForbiddenTab({ id: 1, url });

  it('refuses mapped and encoded loopback literals', () => {
    expect(forbid('http://[::ffff:127.0.0.1]/')).toBe(true);
    expect(forbid('http://[64:ff9b::7f00:1]/')).toBe(true);
    expect(forbid('http://2130706433/')).toBe(true);
    expect(forbid('http://0x7f.1/')).toBe(true);
    expect(forbid('http://127.0.0.1./')).toBe(true);
  });

  it('allows a public IPv6 literal', () => {
    expect(forbid('https://[2606:4700:4700::1111]/')).toBe(false);
  });
});

describe('evaluateResolvedAddresses', () => {
  it('allows a name only when every address is public', () => {
    expect(evaluateResolvedAddresses(['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c']))
      .toEqual({ allowed: true });
  });

  it('refuses when any address is private', () => {
    // Round-robin or dual-stack answers can mix public and private records;
    // Chrome may connect to either.
    expect(evaluateResolvedAddresses(['93.184.215.14', '127.0.0.1']))
      .toEqual({ allowed: false, reason: 'private_address', address: '127.0.0.1' });
  });

  it('fails closed on an empty or missing answer', () => {
    expect(evaluateResolvedAddresses([])).toEqual({ allowed: false, reason: 'no_addresses' });
    expect(evaluateResolvedAddresses(null)).toEqual({ allowed: false, reason: 'no_addresses' });
  });
});

describe('parseDnsJsonAddresses', () => {
  it('collects A and AAAA records, skipping CNAMEs', () => {
    expect(parseDnsJsonAddresses({
      Status: 0,
      Answer: [
        { type: 5, data: 'target.example.net.' },
        { type: 1, data: '127.0.0.1' },
        { type: 28, data: '::1' }
      ]
    })).toEqual(['127.0.0.1', '::1']);
  });

  it('returns an empty list for NOERROR with no answer', () => {
    expect(parseDnsJsonAddresses({ Status: 0 })).toEqual([]);
  });

  it('returns null for a failed lookup so the caller fails closed', () => {
    expect(parseDnsJsonAddresses({ Status: 3 })).toBeNull(); // NXDOMAIN
    expect(parseDnsJsonAddresses({ Status: 2 })).toBeNull(); // SERVFAIL
    expect(parseDnsJsonAddresses(null)).toBeNull();
    expect(parseDnsJsonAddresses('garbage')).toBeNull();
  });
});

describe('evaluateConnectedAddress', () => {
  const doc = (response) => ({ type: 'Document', response: { url: 'https://a.example/', ...response } });

  it('allows a document fetched from a public address', () => {
    expect(evaluateConnectedAddress(doc({ remoteIPAddress: '93.184.215.14' }))).toEqual({ private: false });
  });

  it('flags a document fetched from a private address', () => {
    expect(evaluateConnectedAddress(doc({ remoteIPAddress: '127.0.0.1' })))
      .toEqual({ private: true, reason: 'private_address', address: '127.0.0.1' });
    expect(evaluateConnectedAddress(doc({ remoteIPAddress: '[::1]' })).private).toBe(true);
  });

  it('fails closed on a network document with no remote address', () => {
    expect(evaluateConnectedAddress(doc({}))).toEqual({ private: true, reason: 'no_remote_address' });
  });

  it('does not flag cache- or service-worker-served documents without an address', () => {
    expect(evaluateConnectedAddress(doc({ fromDiskCache: true })).private).toBe(false);
    expect(evaluateConnectedAddress(doc({ fromServiceWorker: true })).private).toBe(false);
    expect(evaluateConnectedAddress(doc({ fromPrefetchCache: true })).private).toBe(false);
  });

  it('ignores non-document responses and non-web documents', () => {
    expect(evaluateConnectedAddress({ type: 'Image', response: { url: 'https://a/', remoteIPAddress: '10.0.0.1' } }).private).toBe(false);
    expect(evaluateConnectedAddress(doc({ url: 'data:text/html,hi' })).private).toBe(false);
  });
});
