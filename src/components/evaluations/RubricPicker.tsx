import { ChoiceCard, ChoiceCardGroup } from '@/components/court/ChoiceCard'
import { Fold } from '@/components/court/Fold'
import { Plain } from '@/components/court/Paper'
import { DIMENSIONS, RUBRIC_VERSION, RUBRIC_VERSIONS, RUBRICS, type RubricVersion } from '@/domain/rubric'

const linesOf = (version: RubricVersion) => DIMENSIONS.map((d) => RUBRICS[version].lines[d].label).join(' · ')

/**
 * Choose the jury's rubric (D-35). Hearings keep the version they started
 * with. It is chosen once per case, so it shows as one line until changed.
 */
export function RubricPicker({ value, onChange, disabled }: { value: RubricVersion | undefined; onChange: (next: RubricVersion) => void; disabled?: boolean }) {
  const current = value ?? RUBRIC_VERSION
  return (
    <fieldset disabled={disabled} className="mb-6">
      <legend id="rubric-legend" className="court-label mb-1">
        The jury’s rubric <Plain>what jurors score; each line is 0–2</Plain>
      </legend>
      <Fold
        summary={
          <span>
            <span className="font-medium text-foreground">{RUBRICS[current].name}</span>
            <span className="hidden sm:inline"> · {linesOf(current)}</span>
            <span className="ml-2 underline underline-offset-4">Change</span>
          </span>
        }
      >
        <ChoiceCardGroup aria-labelledby="rubric-legend" value={current} onValueChange={(v) => onChange(v as RubricVersion)} className="md:grid-cols-3">
          {RUBRIC_VERSIONS.map((version) => (
            <ChoiceCard key={version} id={`rubric-${version}`} value={version} title={RUBRICS[version].name} description={linesOf(version)} />
          ))}
        </ChoiceCardGroup>
      </Fold>
    </fieldset>
  )
}
