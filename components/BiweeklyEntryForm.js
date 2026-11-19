import React, { useState, useEffect } from 'react'
import { useMutation } from 'convex/react'
import { useToast } from './Toast'
import { api } from '../convex/_generated/api'
import { biweeklyCreateArgs } from '../lib/recordArgs'
import { Plus, Trash, Save, AlertCircle, RefreshCw, CheckCircle } from 'lucide-react'
import {
  Button,
  FormCard,
  FormActions,
  Field,
  Input,
} from './ui'
import { localToday } from '../lib/format'
import { customPayload } from './CustomFields'
import FormLayout, { hiddenCoreKeys, useFormLayout } from './FormLayout'

function generateBatchCode() {
  const date = new Date()
  const year = date.getFullYear().toString().slice(-2)
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')
  return `BW${year}${month}${day}${random}`
}

const BiweeklyEntryForm = ({ cage, onComplete }) => {
  const { showToast } = useToast()
  const createBiweekly = useMutation(api.biweeklyRecords.create)
  const [custom, setCustom] = useState({})
  const [samplings, setSamplings] = useState([
    { id: 1, fish_count: '', total_weight: '', abw: 0 },
  ])
  const [date, setDate] = useState(localToday())
  const [batchCode, setBatchCode] = useState(generateBatchCode())
  const [dissolvedOxygen, setDissolvedOxygen] = useState('')
  const [temperatureC, setTemperatureC] = useState('')
  const [secchiCm, setSecchiCm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const layout = useFormLayout('production.sampling')

  useEffect(() => {
    setBatchCode(generateBatchCode())
  }, [])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(false), 3000)
    return () => clearTimeout(timer)
  }, [success])

  const addSampling = () => {
    setSamplings([
      ...samplings,
      {
        id: samplings.length + 1,
        fish_count: '',
        total_weight: '',
        abw: 0,
      },
    ])
  }

  const removeSampling = (index) => {
    if (samplings.length > 1) {
      setSamplings(samplings.filter((_, i) => i !== index))
    }
  }

  const updateSampling = (index, field, value) => {
    const newSamplings = [...samplings]
    newSamplings[index] = {
      ...newSamplings[index],
      [field]: value,
      abw:
        field === 'total_weight' && newSamplings[index].fish_count
          ? (Number(value) / Number(newSamplings[index].fish_count)).toFixed(2)
          : field === 'fish_count' && newSamplings[index].total_weight
            ? (
                Number(newSamplings[index].total_weight) / Number(value)
              ).toFixed(2)
            : newSamplings[index].abw,
    }
    setSamplings(newSamplings)
  }

  const calculateAverageABW = () => {
    const totalWeight = samplings.reduce(
      (sum, s) => sum + Number(s.total_weight || 0),
      0,
    )
    const totalFish = samplings.reduce(
      (sum, s) => sum + Number(s.fish_count || 0),
      0,
    )
    return totalFish > 0 ? totalWeight / totalFish : 0
  }

  const totalFish = samplings.reduce(
    (sum, s) => sum + Number(s.fish_count || 0),
    0,
  )
  const totalWeight = samplings.reduce(
    (sum, s) => sum + Number(s.total_weight || 0),
    0,
  )

  const coreValues = { date, batchCode, dissolvedOxygen, temperatureC, secchiCm, samples: totalFish || '' }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (totalFish === 0 || totalWeight === 0) {
        throw new Error('Please enter valid fish count and weight data')
      }

      const hidden = hiddenCoreKeys(layout.sections, coreValues, custom)
      const shown = (key, v) => (hidden.has(key) || v === '' ? undefined : Number(v))
      const recordData = {
        cage_id: cage.id || cage._id,
        date,
        batch_code: batchCode,
        average_body_weight: calculateAverageABW(),
        total_fish_count: totalFish,
        total_weight: totalWeight,
        dissolved_oxygen: shown('dissolvedOxygen', dissolvedOxygen),
        temperature_c: shown('temperatureC', temperatureC),
        secchi_cm: shown('secchiCm', secchiCm),
        custom: customPayload(custom),
        samples: samplings
          .filter((s) => s.fish_count && s.total_weight)
          .map((sampling, index) => ({
            sampling_number: index + 1,
            fish_count: Number(sampling.fish_count),
            total_weight: Number(sampling.total_weight),
            average_body_weight: Number(sampling.abw),
          })),
      }

      const id = await createBiweekly(biweeklyCreateArgs(recordData))

      showToast('success', 'Biweekly record saved')
      setSuccess(true)
      setDate(localToday())
      setBatchCode(generateBatchCode())
      setDissolvedOxygen('')
      setTemperatureC('')
      setSecchiCm('')
      setCustom({})
      setSamplings([{ id: 1, fish_count: '', total_weight: '', abw: 0 }])

      if (onComplete) {
        setTimeout(() => onComplete({ id }), 500)
      }
    } catch (err) {
      console.error('Failed to save bi-weekly records:', err)
      setError(err.message || 'Failed to save bi-weekly records')
      showToast('error', 'Failed to save bi-weekly records')
    } finally {
      setLoading(false)
    }
  }

  const layoutFields = {
    date: (
      <Field label="Sampling date" htmlFor="date" required>
        <Input
          id="date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </Field>
    ),
    batchCode: (
      <Field label="Batch code" htmlFor="batchCode">
        <div className="flex gap-2">
          <Input
            id="batchCode"
            type="text"
            value={batchCode}
            readOnly
            className="font-data bg-foam"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setBatchCode(generateBatchCode())}
            aria-label="Generate new batch code"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </Field>
    ),
    dissolvedOxygen: (
      <Field label="Dissolved oxygen (mg/L)" htmlFor="bw-do">
        <Input
          id="bw-do"
          type="number"
          step="0.1"
          value={dissolvedOxygen}
          onChange={(e) => setDissolvedOxygen(e.target.value)}
          className="font-data tabular-nums"
        />
      </Field>
    ),
    temperatureC: (
      <Field label="Temperature (°C)" htmlFor="bw-temp">
        <Input
          id="bw-temp"
          type="number"
          step="0.1"
          value={temperatureC}
          onChange={(e) => setTemperatureC(e.target.value)}
          className="font-data tabular-nums"
        />
      </Field>
    ),
    secchiCm: (
      <Field label="Secchi (cm)" htmlFor="bw-secchi">
        <Input
          id="bw-secchi"
          type="number"
          step="1"
          value={secchiCm}
          onChange={(e) => setSecchiCm(e.target.value)}
          className="font-data tabular-nums"
        />
      </Field>
    ),
    samples: (
      <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-muted">
          Each sample needs fish count and total weight.
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={addSampling}>
          <Plus className="w-4 h-4" />
          Add sample
        </Button>
      </div>

      <div className="space-y-4">
        {samplings.map((sampling, index) => (
          <div
            key={sampling.id}
            className="rounded-xl border border-foam-deep bg-surface p-4 sm:p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-chart-ink">
                Sample {index + 1}
              </h4>
              {samplings.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSampling(index)}
                  className="text-signal p-2.5 rounded-lg hover:bg-signal/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
                  title="Remove sample"
                  aria-label="Remove sample"
                >
                  <Trash className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Fish count" htmlFor={`fish-${index}`}>
                <Input
                  id={`fish-${index}`}
                  type="number"
                  value={sampling.fish_count}
                  onChange={(e) =>
                    updateSampling(index, 'fish_count', e.target.value)
                  }
                  min="0"
                  className="font-data tabular-nums"
                  placeholder="Count"
                />
              </Field>
              <Field label="Total weight (g)" htmlFor={`weight-${index}`}>
                <Input
                  id={`weight-${index}`}
                  type="number"
                  value={sampling.total_weight}
                  onChange={(e) =>
                    updateSampling(index, 'total_weight', e.target.value)
                  }
                  min="0"
                  step="0.01"
                  className="font-data tabular-nums"
                  placeholder="0.00"
                />
              </Field>
              <Field
                label="ABW (g)"
                htmlFor={`abw-${index}`}
                hint="Calculated"
              >
                <Input
                  id={`abw-${index}`}
                  type="number"
                  value={sampling.abw}
                  readOnly
                  className="font-data bg-foam"
                />
              </Field>
            </div>
          </div>
        ))}
      </div>
      </div>
    ),
  }

  return (
    <FormCard
      title={`Bi-weekly entry — ${cage.name}`}
      subtitle="Add one or more samples. ABW calculates from weight ÷ fish count."
    >
      {error && (
        <div className="mb-5 text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3 flex items-start gap-2">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-5 text-sm text-kelp border border-kelp/20 bg-kelp/10 rounded-xl p-3 flex items-start gap-2">
          <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>Bi-weekly records saved successfully</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-xl border border-foam-deep bg-foam p-4">
          <div>
            <p className="text-xs text-muted">
              Total fish
            </p>
            <p className="mt-1 text-2xl font-medium tabular-nums text-chart-ink">
              {totalFish.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">
              Total weight
            </p>
            <p className="mt-1 text-2xl font-medium tabular-nums text-chart-ink">
              {totalWeight.toFixed(2)}g
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">
              Average ABW
            </p>
            <p className="mt-1 text-2xl font-medium tabular-nums text-chart-ink">
              {calculateAverageABW().toFixed(2)}g
            </p>
          </div>
        </div>

        <FormLayout
          formKey="production.sampling"
          layout={layout}
          fields={layoutFields}
          coreValues={coreValues}
          custom={custom}
          onCustomChange={setCustom}
          locationId={cage?.location_id}
          core={{ totalFishCount: totalFish, totalWeight }}
          idPrefix="bw-cf"
        />

        <FormActions>
          <Button type="submit" disabled={loading} size="lg">
            {loading ? (
              'Saving…'
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save bi-weekly record
              </>
            )}
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}

export default BiweeklyEntryForm
