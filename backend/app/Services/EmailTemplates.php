<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\EmailTemplate;
use App\Support\Currency;
use App\Support\EmailTemplateCatalog;
use Illuminate\Support\Facades\Cache;

/**
 * Phase 7: renders every email from its template (EmailTemplateCatalog for
 * the defaults, the email_templates table for staff customizations), and
 * checks a template before it is saved.
 *
 * Rendering: {{ name }} in the subject and body is replaced by the value.
 * Text and link values are HTML-escaped in the body (a customer named
 * "<b>Ann</b>" shows exactly that, it doesn't become bold); block values are
 * prebuilt HTML from App\Support\EmailBlocks and go in as they are. The
 * subject is plain text, so its values are not escaped (and can't break
 * the header: line breaks are removed). The body is then put in the store
 * frame (emails/layout), and the plain-text part is made from it.
 */
class EmailTemplates
{
    /** {{ name }}, with optional spaces (also the %20 the sanitizer writes inside links). */
    private const TOKEN = '/\{\{(?:\s|%20)*(.*?)(?:\s|%20)*\}\}/u';

    private const CACHE_KEY = 'buynest.email_templates';

    public function __construct(private HtmlSanitizer $sanitizer, private Settings $settings) {}

    /** The subject and body in use: the saved customization, or the default. */
    public function current(string $key): array
    {
        $saved = Cache::rememberForever(self::CACHE_KEY, fn () => EmailTemplate::query()->get(['key', 'subject', 'body'])
            ->keyBy('key')->map(fn ($row) => ['subject' => $row->subject, 'body' => $row->body])->all())[$key] ?? null;
        $default = EmailTemplateCatalog::get($key);

        return $saved ?? ['subject' => $default['subject'], 'body' => $default['body']];
    }

    /**
     * The email for $key with $values: { subject, html (whole document), text }.
     * $subject/$body: a draft to render instead of the current template (preview).
     * $layout: extra bits for the frame ({ preheader, footer_html, footer_text }).
     */
    public function render(string $key, array $values, ?string $subject = null, ?string $body = null, array $layout = [], ?string $currency = null): array
    {
        $template = $this->current($key);
        $definition = EmailTemplateCatalog::get($key);
        $values = [...$this->commonValues(), ...$values];

        $renderedSubject = $this->fill($subject ?? $template['subject'], $definition['variables'], $values, html: false, currency: $currency);
        $renderedBody = $this->fill($body ?? $template['body'], $definition['variables'], $values, html: true, currency: $currency);

        return $this->wrap(trim(preg_replace('/\s+/u', ' ', $renderedSubject)), $renderedBody, $layout);
    }

    /** Puts a rendered body in the store frame: { subject, html, text }. Also used by newsletters (no template). */
    public function wrap(string $subject, string $bodyHtml, array $layout = []): array
    {
        // Empty paragraphs left by empty values ("<p></p>") go.
        $bodyHtml = preg_replace('#<p>\s*</p>#u', '', $bodyHtml);
        $storeName = (string) $this->settings->get('store_name');

        $html = view('emails.layout', [
            'subject' => $subject,
            'body' => $bodyHtml,
            'storeName' => $storeName,
            'preheader' => $layout['preheader'] ?? null,
            'footerHtml' => $layout['footer_html'] ?? null,
        ])->render();

        $text = self::toText($bodyHtml);
        if (! empty($layout['footer_text'])) {
            $text .= "\n\n".$layout['footer_text'];
        }

        return ['subject' => $subject, 'html' => $html, 'text' => $text];
    }

    /** Sample values for $key (preview and test emails). */
    public function sampleValues(string $key): array
    {
        return EmailTemplateCatalog::sample($key);
    }

    /**
     * Errors for a draft, keyed by field ("subject", "body"): unknown
     * variables, blocks in the subject, link-only places, required ones
     * missing. [] when it's fine. $body must already be sanitized.
     */
    public function errors(string $key, string $subject, string $body): array
    {
        $variables = EmailTemplateCatalog::get($key)['variables'];
        $errors = [];

        foreach (['subject' => $subject, 'body' => $body] as $field => $text) {
            foreach ($this->namesIn($text) as $name) {
                if (! array_key_exists($name, $variables)) {
                    $errors[$field] = "Unknown variable {{ {$name} }}. Use only the variables listed for this template.";
                    break;
                }
                if ($field === 'subject' && $variables[$name][1] === 'block') {
                    $errors[$field] = "{{ {$name} }} can only be used in the body.";
                    break;
                }
            }
        }
        // Inside a link address only link variables make sense (a name in an href could be "javascript:...").
        if (! isset($errors['body']) && preg_match_all('/href="([^"]*)"/i', $body, $links)) {
            foreach ($links[1] as $href) {
                foreach ($this->namesIn($href) as $name) {
                    if (($variables[$name][1] ?? null) !== 'url') {
                        $errors['body'] = "{{ {$name} }} can't be used as a link address. Use a link variable such as "
                            .implode(', ', array_map(fn ($n) => "{{ {$n} }}", array_keys(array_filter($variables, fn ($v) => $v[1] === 'url')) ?: ['…'])).'.';
                        break 2;
                    }
                }
            }
        }
        if (! isset($errors['body'])) {
            $used = [...$this->namesIn($subject), ...$this->namesIn($body)];
            foreach (EmailTemplateCatalog::get($key)['required'] as $group) {
                if (! array_intersect($group, $used)) {
                    $errors['body'] = 'This template must include '.implode(' or ', array_map(fn ($n) => "{{ {$n} }}", $group)).'.';
                    break;
                }
            }
        }

        return $errors;
    }

    /** Sanitizes a body like content pages, keeping {{ name }} usable inside links. */
    public function sanitize(string $body): string
    {
        return preg_replace(self::TOKEN, '{{ $1 }}', $this->sanitizer->clean($body));
    }

    public function save(string $key, string $subject, string $body, ?Admin $admin): EmailTemplate
    {
        $row = EmailTemplate::updateOrCreate(['key' => $key], [
            'subject' => $subject, 'body' => $body, 'is_customized' => true, 'updated_by_admin_id' => $admin?->id,
        ]);
        Cache::forget(self::CACHE_KEY);

        return $row;
    }

    public function reset(string $key): void
    {
        EmailTemplate::where('key', $key)->delete();
        Cache::forget(self::CACHE_KEY);
    }

    /** @return list<string> the variable names written in $text */
    private function namesIn(string $text): array
    {
        preg_match_all(self::TOKEN, $text, $matches);

        return array_values(array_unique($matches[1]));
    }

    private function fill(string $text, array $variables, array $values, bool $html, ?string $currency = null): string
    {
        // Phase 12: "${{ order_total }}" (how every template writes a money variable, saved ones included) means
        // "this amount in the email's currency": "$59.97" in a dollar store, "৳1,250.00" in taka. The order's
        // emails use the order's currency. A money variable written without the "$" stays a plain number.
        $text = preg_replace_callback('/\$'.substr(self::TOKEN, 1, -2).'/u', function (array $match) use ($variables, $values, $html, $currency) {
            $name = $match[1];
            if (! in_array($name, EmailTemplateCatalog::MONEY_VARIABLES, true) || ! array_key_exists($name, $variables)
                || ! is_numeric($values[$name] ?? null)) {
                return $match[0];
            }
            $value = Currency::format($values[$name], $currency);

            return $html ? e($value) : $value;
        }, $text);

        return preg_replace_callback(self::TOKEN, function (array $match) use ($variables, $values, $html) {
            $name = $match[1];
            if (! array_key_exists($name, $variables)) {
                return $match[0];
            }
            $value = (string) ($values[$name] ?? '');
            if ($variables[$name][1] === 'block') {
                return $html ? $value : '';
            }

            return $html ? e($value) : $value;
        }, $text);
    }

    private function commonValues(): array
    {
        return [
            'store_name' => (string) $this->settings->get('store_name'),
            'support_email' => (string) $this->settings->get('support_email'),
        ];
    }

    /**
     * The plain-text version of an email body: links become "text (address)",
     * paragraphs and rows become lines, tags go, entities are decoded.
     */
    public static function toText(string $html): string
    {
        $text = preg_replace('#<(style|script|head)\b.*?</\1>#is', '', $html);
        $text = preg_replace_callback('#<a\b[^>]*href="([^"]*)"[^>]*>(.*?)</a>#is', function ($m) {
            $label = trim(strip_tags($m[2]));
            $url = html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5);

            return $label === '' || $label === $url ? $url : "{$label}: {$url}";
        }, $text);
        $text = preg_replace('#<br\s*/?>#i', "\n", $text);
        $text = preg_replace('#<li\b[^>]*>#i', '- ', $text);
        $text = preg_replace('#</(td|th)>#i', '  ', $text);
        $text = preg_replace('#</(p|h[1-6]|blockquote|table|ul|ol)>#i', "\n\n", $text);
        $text = preg_replace('#</(li|tr|div)>#i', "\n", $text);
        $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5);
        $lines = array_map(fn ($line) => trim(preg_replace('/[ \t]+/', ' ', $line)), explode("\n", $text));

        return trim(preg_replace("/\n{3,}/", "\n\n", implode("\n", $lines)));
    }
}
