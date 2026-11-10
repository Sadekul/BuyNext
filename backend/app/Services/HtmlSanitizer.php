<?php

namespace App\Services;

use Symfony\Component\HtmlSanitizer\HtmlSanitizer as SymfonySanitizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerConfig;

/**
 * Cleans content page HTML before it is saved, so the storefront can show it
 * as it is.
 *
 * Why a library (symfony/html-sanitizer) and not regular expressions: HTML
 * can be written in endless odd ways (unclosed tags, "JaVaScRiPt:", entities,
 * nested quotes) and a regex misses some of them. The library parses the HTML
 * like a browser does, then rebuilds it from an ALLOW-LIST: anything not on
 * the list is gone, so a trick we didn't think of is removed too.
 *
 * Allowed: p, h2-h4, ul, ol, li, strong, em, a (http/https/mailto or a
 * relative address; rel="noopener" is always set), blockquote, br, hr, and
 * tables. Scripts, styles, iframes, event attributes (onclick...), style
 * attributes, and javascript: links are removed.
 */
class HtmlSanitizer
{
    public const MAX_LENGTH = 100000;

    private const ALLOWED = [
        'p' => [], 'h2' => [], 'h3' => [], 'h4' => [], 'ul' => [], 'ol' => [], 'li' => [],
        'strong' => [], 'em' => [], 'blockquote' => [], 'br' => [], 'hr' => [],
        'a' => ['href', 'title'],
        'table' => [], 'caption' => [], 'thead' => [], 'tbody' => [], 'tfoot' => [], 'tr' => [],
        'th' => ['colspan', 'rowspan', 'scope'], 'td' => ['colspan', 'rowspan'],
    ];

    // Harmless wrappers: the tag goes, its text stays (pasted "<div><b>Hi</b></div>" keeps "Hi").
    // Everything else that isn't allowed (script, style, iframe, object, form...) goes with its content.
    private const UNWRAPPED = ['div', 'span', 'section', 'article', 'header', 'footer', 'main', 'b', 'i', 'u',
        'small', 'mark', 'sub', 'sup', 'h1', 'h5', 'h6', 'font', 'center', 'code', 'pre', 'dl', 'dt', 'dd', 'figure', 'figcaption'];

    private SymfonySanitizer $sanitizer;

    public function __construct()
    {
        $config = (new HtmlSanitizerConfig)
            ->allowLinkSchemes(['http', 'https', 'mailto'])
            ->allowRelativeLinks()
            ->forceAttribute('a', 'rel', 'noopener')
            ->withMaxInputLength(self::MAX_LENGTH);
        foreach (self::ALLOWED as $element => $attributes) {
            $config = $config->allowElement($element, $attributes);
        }
        foreach (self::UNWRAPPED as $element) {
            $config = $config->blockElement($element);
        }

        $this->sanitizer = new SymfonySanitizer($config);
    }

    public function clean(string $html): string
    {
        return trim($this->sanitizer->sanitize($html));
    }
}
