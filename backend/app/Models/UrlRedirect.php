<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/** Phase 7: an old store address that now lives elsewhere (Magento's URL rewrites). */
#[Fillable(['from_path', 'to_path', 'status_code', 'hits'])]
class UrlRedirect extends Model
{
    protected function casts(): array
    {
        return ['status_code' => 'integer', 'hits' => 'integer'];
    }

    /**
     * The form paths are stored and looked up in: no query or #fragment, no
     * trailing slash (except "/" itself), lower-case. "/Old-Page/?utm=x" → "/old-page".
     */
    public static function normalize(string $path): string
    {
        $path = trim($path);
        $path = preg_split('/[?#]/', $path, 2)[0];
        $path = mb_strtolower($path);

        return $path === '/' ? '/' : rtrim($path, '/');
    }
}
