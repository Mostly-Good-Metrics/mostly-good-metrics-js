import { computeExperimentBucket, sha256, utf8Encode } from './sha256';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

describe('utf8Encode', () => {
  it('should encode ASCII strings', () => {
    expect(Array.from(utf8Encode('abc'))).toEqual([0x61, 0x62, 0x63]);
  });

  it('should encode the empty string', () => {
    expect(utf8Encode('').length).toBe(0);
  });

  it('should match Node UTF-8 encoding for multi-byte text', () => {
    const samples = [
      'user_123',
      '日本語ユーザー',
      'chris@nihongo.example',
      'héllo wörld',
      'emoji 👩‍👩‍👧‍👦 test',
      '$anon_abc123def456',
    ];
    for (const sample of samples) {
      expect(Array.from(utf8Encode(sample))).toEqual(Array.from(Buffer.from(sample, 'utf8')));
    }
  });
});

describe('sha256', () => {
  // FIPS 180-4 / NIST test vectors
  it('should produce the NIST digest for "abc"', () => {
    expect(toHex(sha256(utf8Encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('should produce the NIST digest for the empty message', () => {
    expect(toHex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('should produce the NIST digest for the two-block message', () => {
    expect(
      toHex(sha256(utf8Encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('should handle messages spanning the 55/56-byte padding boundary', () => {
    // 55, 56 and 64 byte messages exercise the padding edge cases
    expect(toHex(sha256(utf8Encode('a'.repeat(55))))).toBe(
      toHex(sha256(Uint8Array.from(Array(55).fill(0x61))))
    );
    const digest56 = toHex(sha256(utf8Encode('a'.repeat(56))));
    const digest64 = toHex(sha256(utf8Encode('a'.repeat(64))));
    expect(digest56).toHaveLength(64);
    expect(digest64).toHaveLength(64);
    expect(digest56).not.toBe(digest64);
  });
});

describe('computeExperimentBucket (golden vectors, shared across all MGM SDKs)', () => {
  // These vectors are shared with the Swift, Android and Flutter SDKs.
  // bucket = first 8 bytes of SHA-256(utf8("<experiment_uuid>:<user_id>"))
  //          as an unsigned big-endian 64-bit integer
  // variant = variants[bucket % variants.length]
  const goldenVectors: {
    experiment_id: string;
    user_id: string;
    variants: string[];
    bucket: string;
    expected_variant: string;
  }[] = [
    {
      experiment_id: '7b1e8a90-4c2d-4f6a-9e3b-2a1d5c8f0e71',
      user_id: 'user_123',
      variants: ['control', 'treatment'],
      bucket: '11452140836674321702',
      expected_variant: 'control',
    },
    {
      experiment_id: '7b1e8a90-4c2d-4f6a-9e3b-2a1d5c8f0e71',
      user_id: '$anon_abc123def456',
      variants: ['control', 'treatment'],
      bucket: '10935638356306450407',
      expected_variant: 'treatment',
    },
    {
      experiment_id: '3f9c2d11-8b7a-4e5f-a0c6-91d2e3f4a5b6',
      user_id: 'user_123',
      variants: ['a', 'b', 'c'],
      bucket: '3772238658190659659',
      expected_variant: 'c',
    },
    {
      experiment_id: '3f9c2d11-8b7a-4e5f-a0c6-91d2e3f4a5b6',
      user_id: 'chris@nihongo.example',
      variants: ['a', 'b', 'c'],
      bucket: '15293329125595004806',
      expected_variant: 'b',
    },
    {
      experiment_id: 'c0ffee00-1234-5678-9abc-def012345678',
      user_id: 'u',
      variants: ['on', 'off'],
      bucket: '5314609686893464838',
      expected_variant: 'on',
    },
    {
      experiment_id: 'c0ffee00-1234-5678-9abc-def012345678',
      user_id: '日本語ユーザー',
      variants: ['on', 'off'],
      bucket: '15854517259962621242',
      expected_variant: 'on',
    },
    {
      experiment_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000',
      user_id: 'user_with_long_id_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      variants: ['v1', 'v2', 'v3', 'v4', 'v5'],
      bucket: '16479651874404423415',
      expected_variant: 'v1',
    },
    {
      experiment_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000',
      user_id: '',
      variants: ['v1', 'v2'],
      bucket: '2902893145859674316',
      expected_variant: 'v1',
    },
  ];

  it.each(goldenVectors)(
    'vector: experiment $experiment_id, user "$user_id" -> $expected_variant',
    ({ experiment_id, user_id, variants, bucket, expected_variant }) => {
      const computedBucket = computeExperimentBucket(experiment_id, user_id);

      // Raw bucket value must match exactly
      expect(computedBucket.toString()).toBe(bucket);

      // And the derived variant must match
      const variant = variants[Number(computedBucket % BigInt(variants.length))];
      expect(variant).toBe(expected_variant);
    }
  );

  it('should exceed Number.MAX_SAFE_INTEGER for some vectors (BigInt required)', () => {
    const bucket = computeExperimentBucket(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000',
      'user_with_long_id_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    );
    expect(bucket > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});
