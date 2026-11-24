import { useQuery } from '@tanstack/react-query'
import { getAreas, getDistricts, getDivisions, phase14Keys } from '../api/phase14'
import { areaLabel, suggestedPostcode } from '../utils/bangladesh'
import Field from './Field'

const err = (errors, field) => errors?.[field]?.[0]
const DAY = 24 * 60 * 60 * 1000

/**
 * Phase 14 §2: Division → District → Area (upazila or metro thana) for a
 * Bangladesh address. Native selects: keyboard friendly, and on phones they
 * open the system picker (typing a letter jumps to it). Choosing a division
 * clears the district and area; choosing a district clears the area; an area
 * with exactly one postcode fills the postcode when it is empty (or was the
 * previous suggestion). The places rarely change, so they are kept a day.
 */
function BdPlaceFields({ value, onChange, errors = {}, autoCompletePrefix = '', areaOptional = false }) {
  const divisionId = value.divisionId ? String(value.divisionId) : ''
  const districtId = value.districtId ? String(value.districtId) : ''
  const areaId = value.areaId ? String(value.areaId) : ''
  const divisions = useQuery({ queryKey: phase14Keys.divisions, queryFn: ({ signal }) => getDivisions({ signal }), staleTime: DAY })
  const districts = useQuery({ queryKey: phase14Keys.districts(divisionId), queryFn: ({ signal }) => getDistricts(divisionId, { signal }), enabled: divisionId !== '', staleTime: DAY })
  const areas = useQuery({ queryKey: phase14Keys.areas(districtId), queryFn: ({ signal }) => getAreas(districtId, { signal }), enabled: districtId !== '', staleTime: DAY })
  const areaList = areas.data?.places ?? []
  const auto = (token) => `${autoCompletePrefix ? `${autoCompletePrefix} ` : ''}${token}`

  function chooseArea(id) {
    const before = areaList.find((area) => String(area.id) === areaId)
    const area = areaList.find((item) => String(item.id) === id)
    const suggestion = suggestedPostcode(area)
    const postal = value.postalCode?.trim() ?? ''
    const wasSuggested = postal !== '' && postal === suggestedPostcode(before)
    // A suggestion replaces an empty postcode or the previous suggestion; an area without one takes the old suggestion back.
    const postalCode = suggestion && (postal === '' || wasSuggested) ? suggestion : wasSuggested ? '' : value.postalCode
    onChange({ ...value, areaId: id, postalCode })
  }

  const select = ({ query, list, current, placeholder, waiting, label, onPick, empty = 'Choose…', describe = (place) => place.name, ...rest }) => (a11y) => (
    <select {...a11y} {...rest} value={current} disabled={waiting} aria-busy={query.isFetching || undefined} onChange={(event) => onPick(event.target.value)}>
      <option value="">{waiting ? placeholder : query.isPending ? 'Loading…' : query.error ? `Couldn't load the ${label}` : empty}</option>
      {list.map((place) => (
        <option key={place.id} value={String(place.id)}>
          {describe(place)}
        </option>
      ))}
    </select>
  )

  const loadError = (query, what) => (query.error ? `Couldn't load the ${what}: ${query.error.message}` : undefined)
  return (
    <>
      <Field label="Division" error={err(errors, 'divisionId') ?? loadError(divisions, 'divisions')}>
        {select({
          query: divisions,
          list: divisions.data?.places ?? [],
          current: divisionId,
          label: 'divisions',
          autoComplete: auto('address-level1'),
          onPick: (id) => onChange({ ...value, divisionId: id, districtId: '', areaId: '' }),
        })}
      </Field>
      <Field label="District" error={err(errors, 'districtId') ?? loadError(districts, 'districts')} hint={divisionId ? undefined : 'Choose the division first.'}>
        {select({
          query: districts,
          list: districts.data?.places ?? [],
          current: districtId,
          waiting: divisionId === '',
          placeholder: 'Choose the division first',
          label: 'districts',
          autoComplete: auto('address-level2'),
          onPick: (id) => onChange({ ...value, districtId: id, areaId: '' }),
        })}
      </Field>
      <Field
        label={areaOptional ? 'Area (optional)' : 'Area (upazila or thana)'}
        error={err(errors, 'areaId') ?? loadError(areas, 'areas')}
        hint={districtId ? 'Thanas are the city areas of the metropolitan districts.' : 'Choose the district first.'}
      >
        {select({
          query: areas,
          list: areaList,
          current: areaId,
          waiting: districtId === '',
          placeholder: 'Choose the district first',
          label: 'areas',
          autoComplete: auto('address-level3'),
          describe: areaLabel,
          empty: areaOptional ? 'Whole district' : 'Choose…',
          onPick: chooseArea,
        })}
      </Field>
    </>
  )
}

export default BdPlaceFields
