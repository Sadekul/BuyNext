<?php

use Database\Seeders\BanglaDemoContentSeeder;
use Illuminate\Database\Migrations\Migration;

/*
 * Bangla drafts for the demo home hero, banners, and category names. The seeder fills only empty Bangla
 * fields whose English is still the demo text, so anything staff wrote stays as it is. On a fresh install
 * the categories don't exist yet here; DatabaseSeeder runs the seeder again after importing the catalog.
 */
return new class extends Migration
{
    public function up(): void
    {
        (new BanglaDemoContentSeeder)->run();
    }

    public function down(): void
    {
        // Translations may have been edited by staff since: they stay.
    }
};
