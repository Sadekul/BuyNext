import { useId } from 'react'
import BanglaField from './BanglaField'
import StatusBadge from './StatusBadge'
import { banglaProgress } from '../utils/bangla'

/**
 * Phase 13 §4: the product's Bangla texts, saved with the product: name,
 * short description, description, SEO title and description, the saved
 * options' and values' names, and each specification row. Empty fields fall
 * back to English in the store; each says so, with the English text shoppers
 * see instead. Every input has lang="bn".
 *
 * `values` = { name, shortDescription, description, metaTitle, metaDescription },
 * `english` = the English form values ({ title, description, metaTitle, metaDescription }),
 * `specs` = the specification rows ({ key, label, value, labelBn, valueBn }),
 * `options` = [{ id, name, nameBn, values: [{ id, value, valueBn }] }] (saved options only).
 */
function ProductBangla({ values, onChange, english, specs, onSpecsChange, options, onOptionsChange, errors = {}, disabled = false }) {
  const id = useId()
  const set = (field) => (text) => onChange({ ...values, [field]: text })
  const englishTexts = { name: english.title, shortDescription: english.description, description: english.description, metaTitle: english.metaTitle, metaDescription: english.metaDescription }
  const progress = banglaProgress(values, englishTexts, ['name', 'description', 'metaTitle', 'metaDescription'])
  const filledSpecs = specs.filter((row) => row.label.trim() || row.value.trim())
  const setSpec = (key, field) => (text) => onSpecsChange(specs.map((row) => (row.key === key ? { ...row, [field]: text } : row)))
  const setOptionName = (optionId) => (text) => onOptionsChange(options.map((option) => (option.id === optionId ? { ...option, nameBn: text } : option)))
  const setValueName = (optionId, valueId) => (text) =>
    onOptionsChange(options.map((option) => (option.id === optionId ? { ...option, values: option.values.map((entry) => (entry.id === valueId ? { ...entry, valueBn: text } : entry)) } : option)))

  return (
    <fieldset className="form__fieldset bangla-section" aria-describedby={`${id}-hint`} disabled={disabled}>
      <legend>
        Bangla{' '}
        <span lang="bn" className="muted">
          (বাংলা)
        </span>
      </legend>
      <p id={`${id}-hint`} className="field__hint">
        What shoppers see when they use the store in Bangla. Leave a field empty to show the English text there. {progress.done} of {progress.total} main texts translated.{' '}
        {progress.total > 0 && progress.done === progress.total ? <StatusBadge tone="success" label="Complete" /> : <StatusBadge tone="warning" label="Missing texts" />}
      </p>
      <div className="form__grid">
        <BanglaField label="Name in Bangla" value={values.name} english={english.title} onChange={set('name')} maxLength={120} error={errors['bn.name']} className="form__wide" />
        <BanglaField
          label="Short description in Bangla (optional)"
          value={values.shortDescription}
          english={english.description}
          onChange={set('shortDescription')}
          maxLength={500}
          multiline
          rows={2}
          error={errors['bn.shortDescription']}
          className="form__wide"
        />
        <BanglaField label="Description in Bangla" value={values.description} english={english.description} onChange={set('description')} maxLength={5000} multiline rows={5} error={errors['bn.description']} className="form__wide" />
        <BanglaField label="Meta title in Bangla (optional)" value={values.metaTitle} english={english.metaTitle || english.title} onChange={set('metaTitle')} maxLength={190} error={errors['bn.metaTitle']} />
        <BanglaField
          label="Meta description in Bangla (optional)"
          value={values.metaDescription}
          english={english.metaDescription || english.description}
          onChange={set('metaDescription')}
          maxLength={500}
          multiline
          rows={2}
          error={errors['bn.metaDescription']}
        />
      </div>

      <fieldset className="form__fieldset">
        <legend>Option and value names in Bangla</legend>
        {options.length === 0 ? (
          <p className="muted">No saved options. Save the options below first, then name them in Bangla here.</p>
        ) : (
          options.map((option) => (
            <div key={option.id} className="bangla-option">
              <BanglaField label={`“${option.name}” in Bangla`} value={option.nameBn} english={option.name} onChange={setOptionName(option.id)} maxLength={40} />
              <div className="form__grid">
                {option.values.map((entry) => (
                  <BanglaField key={entry.id} label={`${option.name} “${entry.value}” in Bangla`} value={entry.valueBn} english={entry.value} onChange={setValueName(option.id, entry.id)} maxLength={40} />
                ))}
              </div>
            </div>
          ))
        )}
        {errors.optionTranslations && (
          <p className="field__error" role="alert">
            {errors.optionTranslations}
          </p>
        )}
      </fieldset>

      <fieldset className="form__fieldset">
        <legend>Specifications in Bangla</legend>
        {filledSpecs.length === 0 ? (
          <p className="muted">No specifications yet. Add them under Specifications, then translate them here.</p>
        ) : (
          <ol className="spec-rows">
            {filledSpecs.map((row, index) => (
              <li key={row.key} className="spec-row">
                <div className="spec-row__fields">
                  <BanglaField label={`Label ${index + 1} in Bangla`} value={row.labelBn ?? ''} english={row.label} onChange={setSpec(row.key, 'labelBn')} maxLength={60} />
                  <BanglaField label={`Value ${index + 1} in Bangla`} value={row.valueBn ?? ''} english={row.value} onChange={setSpec(row.key, 'valueBn')} maxLength={255} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </fieldset>
    </fieldset>
  )
}

export default ProductBangla
