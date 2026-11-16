<?php

namespace App\Models;

use App\Services\SearchTerms;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/** A normalized catalog search term, how often it was searched, and an optional redirect (Magento's Search terms). */
#[Fillable(['term', 'hits', 'last_results_count', 'redirect_url'])]
class SearchTerm extends Model
{
    protected function casts(): array
    {
        return ['hits' => 'integer', 'last_results_count' => 'integer'];
    }

    protected static function booted(): void
    {
        static::saved(fn (self $term) => $term->wasChanged('redirect_url') || $term->wasRecentlyCreated ? SearchTerms::flushRedirects() : null);
        static::deleted(fn () => SearchTerms::flushRedirects());
    }

    public function toAdminArray(): array
    {
        return [
            'id' => $this->id,
            'term' => $this->term,
            'hits' => $this->hits,
            'last_results_count' => $this->last_results_count,
            'redirect_url' => $this->redirect_url,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
