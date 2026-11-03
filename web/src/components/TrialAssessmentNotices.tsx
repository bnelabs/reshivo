import type { ProductCheck, TrialConfiguration } from '../projectWorkspace'
import { trialAssessmentError, trialAssessmentQuestion } from '../trialAssessmentNotices'

type Assessment = {
  configurations?: { id?: unknown; revision?: unknown; checks?: { check_id?: unknown; state?: unknown }[] }[]
  errors?: unknown[]
  questions?: unknown[]
}

export function TrialAssessmentNotices({ assessment, setups, checks, kind, setupName, onAddReading }: {
  assessment: Assessment
  setups: TrialConfiguration[]
  checks: ProductCheck[]
  kind: 'synthetic' | 'user_reported'
  setupName: (setup: TrialConfiguration) => string
  onAddReading: (setup: TrialConfiguration, check: ProductCheck) => void
}) {
  return <>
    {assessment.errors?.map((error, index) => <p className="pw-error" key={`error-${index}`}>
      {trialAssessmentError(error)}
    </p>)}
    {assessment.questions?.map((question, index) => {
      const notice = trialAssessmentQuestion(question, assessment, setups, checks, kind, setupName)
      return <p key={`question-${index}`}>
        {notice.text}{notice.reading && <> <button type="button" onClick={() => onAddReading(notice.reading!.setup, notice.reading!.check)}>Add reading</button></>}
      </p>
    })}
  </>
}
