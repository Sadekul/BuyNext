<?php

namespace Tests\Unit;

use App\Services\TwoFactor;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Phase 9 (part A): the TOTP maths against RFC 6238 Appendix B (SHA-1 key
 * "12345678901234567890"). The RFC lists 8-digit codes; a 6-digit code is the
 * same number modulo 10^6, i.e. its last 6 digits.
 */
class TotpTest extends TestCase
{
    private const RFC_KEY = '12345678901234567890';

    /** @return array<string, array{int, string}> unix time => the RFC's 8-digit SHA-1 code */
    public static function rfcVectors(): array
    {
        return [
            '59' => [59, '94287082'],
            '1111111109' => [1111111109, '07081804'],
            '1111111111' => [1111111111, '14050471'],
            '1234567890' => [1234567890, '89005924'],
            '2000000000' => [2000000000, '69279037'],
            '20000000000' => [20000000000, '65353130'],
        ];
    }

    #[DataProvider('rfcVectors')]
    public function test_rfc_6238_sha1_vectors(int $time, string $eightDigits): void
    {
        $step = TwoFactor::stepAt($time);

        $this->assertSame($eightDigits, TwoFactor::codeAt(self::RFC_KEY, $step, 8));
        $this->assertSame(substr($eightDigits, -6), TwoFactor::codeAt(self::RFC_KEY, $step));
    }

    #[DataProvider('rfcVectors')]
    public function test_a_base32_secret_matches_at_its_step_and_one_step_either_side(int $time, string $eightDigits): void
    {
        $secret = TwoFactor::base32Encode(self::RFC_KEY);
        $code = substr($eightDigits, -6);
        $step = TwoFactor::stepAt($time);

        $this->assertSame($step, TwoFactor::matchingStep($secret, $code, $time));
        $this->assertSame($step, TwoFactor::matchingStep($secret, $code, $time + 30)); // the app's clock is a step behind
        $this->assertSame($step, TwoFactor::matchingStep($secret, $code, $time - 30)); // ...or ahead
        $this->assertNull(TwoFactor::matchingStep($secret, $code, $time + 90));
        $this->assertNull(TwoFactor::matchingStep($secret, '12345', $time));
        $this->assertNull(TwoFactor::matchingStep($secret, 'abcdef', $time));
    }

    public function test_base32_round_trip(): void
    {
        $this->assertSame('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', TwoFactor::base32Encode(self::RFC_KEY));
        $this->assertSame(self::RFC_KEY, TwoFactor::base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'));

        $secret = TwoFactor::newSecret();
        $this->assertMatchesRegularExpression('/^[A-Z2-7]{32}$/', $secret);
        $this->assertSame(20, strlen(TwoFactor::base32Decode($secret)));
    }
}
