import { useId, useState } from 'react'
import { useController, useWatch } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import FormField from '../forms/FormField'
import Button from '../ui/Button'
import { cn } from '../../utils/classNames'
import { areasQuery, districtsQuery, divisionsQuery } from '../../queries/placesQueries'
import { placeName, suggestedPostcode } from '../../utils/bangladesh'

// More areas than this in a district: a box to narrow the list (phones have no type-ahead in a picker).
const FILTER_FROM = 12

/**
 * One cascading <select> (Division, District or Area), controlled by React
 * Hook Form so a saved value shows as soon as its list arrives. `places`:
 * the list (null while it loads); a failed list says so with "Try again".
 */
function PlaceSelect({ name, control, label, placeholder, places, status, onRetry, disabled, error, onPicked, autoComplete, hint, children }) {
  const { t } = useTranslation('common')
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const {
    field: { ref, name: fieldName, onBlur, onChange, value: current },
  } = useController({ name, control })
  const value = current === null || current === undefined ? '' : String(current)
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined
  const options = places ?? []
  const known = value === '' || options.some((place) => String(place.id) === value)

  return (
    <div className={cn('form-field', error && 'form-field--invalid')}>
      <label htmlFor={id} className="form-field__label">
        {label}
      </label>
      {children}
      <select
        id={id}
        ref={ref}
        name={fieldName}
        className="form-field__input form-field__select"
        value={value}
        disabled={disabled || status === 'pending'}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onBlur={onBlur}
        onChange={(event) => {
          onChange(event.target.value)
          onPicked?.(options.find((place) => String(place.id) === event.target.value) ?? null)
        }}
      >
        <option value="">{status === 'pending' && !disabled ? t('bdAddress.loading') : placeholder}</option>
        {/* A saved value whose list hasn't arrived (or was filtered out) stays selectable. */}
        {!known && <option value={value}>{t('bdAddress.saved')}</option>}
        {options.map((place) => (
          <option key={place.id} value={String(place.id)}>
            {placeName(place)}
          </option>
        ))}
      </select>
      {hint && (
        <p id={hintId} className="form-field__hint">
          {hint}
        </p>
      )}
      {status === 'error' && (
        <div className="bd-address__failed" role="alert">
          <p>{t('bdAddress.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('bdAddress.retry')}
          </Button>
        </div>
      )}
      {error && (
        <p id={errorId} className="form-field__error">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Phase 14: a Bangladesh address (docs/backend/PHASE14_CONTRACT.md §2):
 * Division → District → Area (upazila or thana), names in the shopper's
 * language, then house/road/village and an optional postcode, filled in when
 * the area has exactly one. The hidden city and state follow the district and
 * division (English), so documents and other screens keep working; the API
 * fills them from the ids anyway.
 *
 * `form`: { control, setValue } of the React Hook Form; `field(name)` registers a text field.
 */
function BangladeshAddressFields({ prefix, form, errors = {}, field, ac, countrySelect }) {
  const { t } = useTranslation('common')
  const { control, setValue } = form
  const path = (name) => (prefix ? `${prefix}.${name}` : name)
  const [divisionId, districtId, areaId, postalCode] = useWatch({ control, name: [path('divisionId'), path('districtId'), path('areaId'), path('postalCode')] })
  const [filter, setFilter] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const filterId = useId()

  const divisions = useQuery(divisionsQuery())
  const districts = useQuery(districtsQuery(divisionId))
  const areas = useQuery(areasQuery(districtId))

  const change = (name, value) => setValue(path(name), value, { shouldDirty: true })
  const areaList = areas.data ?? null
  const area = areaList?.find((place) => String(place.id) === String(areaId ?? '')) ?? null
  const suggestion = suggestedPostcode(area)
  const postcodes = area?.postcodes ?? []

  const needle = filter.trim().toLowerCase()
  const shownAreas = areaList && needle
    ? areaList.filter((place) => String(place.id) === String(areaId ?? '') || [place.nameEn, place.nameBn, place.name].some((name) => name?.toLowerCase().includes(needle)))
    : areaList

  function pickedDivision(place) {
    change('districtId', '')
    change('areaId', '')
    setFilter('')
    change('state', place?.nameEn ?? '')
    change('city', '')
  }

  function pickedDistrict(place) {
    change('areaId', '')
    setFilter('')
    change('city', place?.nameEn ?? '')
  }

  function pickedArea(place) {
    const only = suggestedPostcode(place)
    // Fill the postcode when the area has exactly one, unless the shopper typed another one.
    const previous = suggestedPostcode(area)
    if (only && (!postalCode || postalCode === previous)) {
      change('postalCode', only)
      setAnnouncement(t('bdAddress.postcodeFilled', { code: only }))
    } else if (!only && postalCode && postalCode === previous) {
      change('postalCode', '')
      setAnnouncement('')
    } else {
      setAnnouncement('')
    }
  }

  const postcodeHint = suggestion
    ? t('bdAddress.postcodeOne', { code: suggestion })
    : postcodes.length > 1
      ? t('bdAddress.postcodeSeveral', { codes: postcodes.join(', ') })
      : t('bdAddress.postcodeHint')

  return (
    <div className="address-fields address-fields--bd">
      <FormField label={t('address.firstName')} autoComplete={ac('given-name')} {...field('firstName')} />
      <FormField label={t('address.lastName')} autoComplete={ac('family-name')} {...field('lastName')} />
      <PlaceSelect
        name={path('divisionId')}
        control={control}
        label={t('bdAddress.division')}
        placeholder={t('bdAddress.chooseDivision')}
        places={divisions.data ?? null}
        status={divisions.status}
        onRetry={() => divisions.refetch()}
        error={errors.divisionId?.message}
        onPicked={pickedDivision}
        autoComplete={ac('address-level1')}
      />
      <PlaceSelect
        name={path('districtId')}
        control={control}
        label={t('bdAddress.district')}
        placeholder={divisionId ? t('bdAddress.chooseDistrict') : t('bdAddress.divisionFirst')}
        places={districts.data ?? null}
        status={divisionId ? districts.status : 'idle'}
        onRetry={() => districts.refetch()}
        disabled={!divisionId}
        error={errors.districtId?.message}
        onPicked={pickedDistrict}
        autoComplete={ac('address-level2')}
      />
      <PlaceSelect
        name={path('areaId')}
        control={control}
        label={t('bdAddress.area')}
        placeholder={districtId ? t('bdAddress.chooseArea') : t('bdAddress.districtFirst')}
        places={shownAreas}
        status={districtId ? areas.status : 'idle'}
        onRetry={() => areas.refetch()}
        disabled={!districtId}
        error={errors.areaId?.message}
        onPicked={pickedArea}
        autoComplete={ac('address-level3')}
        hint={t('bdAddress.areaHint')}
      >
        {areaList && areaList.length > FILTER_FROM && (
          <div className="bd-address__filter">
            <label htmlFor={filterId} className="visually-hidden">
              {t('bdAddress.filterLabel')}
            </label>
            <input
              id={filterId}
              type="search"
              className="form-field__input"
              placeholder={t('bdAddress.filterPlaceholder')}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              autoComplete="off"
            />
          </div>
        )}
      </PlaceSelect>
      <p className="visually-hidden" role="status">
        {needle && shownAreas ? t('bdAddress.filterCount', { count: shownAreas.length }) : announcement}
      </p>
      <FormField className="address-fields__wide" label={t('bdAddress.line1')} autoComplete={ac('address-line1')} hint={t('bdAddress.line1Hint')} {...field('line1')} />
      <FormField className="address-fields__wide" label={t('bdAddress.line2')} autoComplete={ac('address-line2')} {...field('line2')} />
      <FormField label={t('bdAddress.postcode')} inputMode="numeric" autoComplete={ac('postal-code')} hint={postcodeHint} {...field('postalCode')} />
      {countrySelect}
    </div>
  )
}

export default BangladeshAddressFields
