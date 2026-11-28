<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 22 (a bug found while building it): `buynest:import-catalog` replaced
 * a product's reviews "without a customer" on every run, to refresh the
 * DummyJSON demo reviews. But a customer who erases their account keeps their
 * reviews with customer_id null, so a re-import deleted those real reviews
 * too. Imported reviews are now marked (`imported`), and only they are replaced.
 *
 * Backfill: a review without a customer counts as imported when it looks like
 * DummyJSON's: no title, not a verified purchase, and a full two-word name
 * ("Lucas Gordon"). Reviews written in the shop are signed "Nadia R." (first
 * name and initial) or with the first name alone, so they stay unmarked.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reviews', function (Blueprint $table) {
            $table->boolean('imported')->default(false)->after('verified_purchase');
        });

        $marked = 0;
        DB::table('reviews')->whereNull('customer_id')->whereNull('title')->where('verified_purchase', false)
            ->orderBy('id')->select(['id', 'author_name'])
            ->chunkById(500, function ($rows) use (&$marked) {
                $ids = $rows->filter(fn ($row) => self::looksImported((string) $row->author_name))->pluck('id')->all();
                if ($ids) {
                    $marked += DB::table('reviews')->whereIn('id', $ids)->update(['imported' => true]);
                }
            });

        if (app()->runningInConsole() && ! app()->runningUnitTests()) {
            echo "  Imported demo reviews marked: {$marked}\n";
        }
    }

    public function down(): void
    {
        Schema::table('reviews', function (Blueprint $table) {
            $table->dropColumn('imported');
        });
    }

    /** "Lucas Gordon" yes; "Nadia R.", "Nadia" no. */
    public static function looksImported(string $name): bool
    {
        return preg_match('/^\S+(\s+\S+)+$/u', trim($name)) === 1 && preg_match('/\s\S\.$/u', trim($name)) !== 1;
    }
};
