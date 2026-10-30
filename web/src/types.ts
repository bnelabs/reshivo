export type Requirements = Record<string, number>
export type Section = {
  shape: 'rectangle' | 'i'
  width_mm: number
  height_mm: number
  flange_mm: number | null
  web_mm: number | null
}
export type Evaluation = {
  passes_declared_screens: boolean
  failed_screens: string[]
  volume_mm3?: number
  tip_deflection_mm?: number
  root_bending_stress_MPa?: number
}
export type Material = {
  id: string
  specimens: number
  modulus_MPa: number
  modulus_sd_MPa: number
  yield_stress_MPa: number
  yield_stress_sd_MPa: number
  break_strain_percent: number
  source_url: string
  named_formulation: string | null
  density_kg_m3: number | null
  missing: string[]
}
export type Design = {
  id?: string
  name?: string
  rationale?: string
  family?: string
  material_id?: string
  section: Section
  evaluation: Evaluation
  outline: number[][]
  stl_url?: string
  design_url?: string
}
export type Bootstrap = {
  materials: Material[]
  config: { requirements: Requirements; search: Record<string, number> }
  source: { url: string; license: string }
  limits: string[]
  meta: { configured: boolean; model: string }
}
export type Experiment = {
  id: string
  requirements: Requirements
  scenario: string
  exports: Design[]
  report_url: string
  results_url: string
  results: {
    material_id: string
    families: Record<string, { evaluated: number; best: unknown }>
    i_volume_reduction_vs_optimized_rectangle_percent: number | null
  }[]
  limits: string[]
}
export type Proposals = {
  live: boolean
  model: string
  candidates: Design[]
  usage: Record<string, number>
  elapsed_ms: number
  report_url?: string
  limits: string[]
}

export type DensityCase = {
  id: string
  label: string
  source_url: string
  source_title: string
  license: string
  material: string
  process: string
  method: string
  test_temperature_C: number
  n: number
  repetition_level: string
  density_values_g_cm3: number[]
  density_mean_g_cm3: number
  density_min_g_cm3: number
  density_max_g_cm3: number
  source_cells: string[]
  limitations: string[]
}

export type ProductCatalog = {
  label: 'source_measurements'
  density_cases: DensityCase[]
  source_groups: {
    id: string
    title: string
    summary: string
    can_answer: string
    cannot_answer: string[]
    source_url: string
    license: string
  }[]
  limits: string[]
}

export type CounterweightResult = {
  result_kind: 'simulation'
  product_name: string
  condition: DensityCase
  volume_cm3: number
  target_min_kg: number
  target_max_kg: number
  mean_density_mass_kg: number
  source_scenarios_kg: number[]
  observed_source_mass_min_kg: number
  observed_source_mass_max_kg: number
  source_scenarios_in_target: number
  source_scenario_count: number
  all_source_scenarios_in_target: boolean
  suggested_volume_cm3: number
  volume_interval_for_source_range_cm3: { min: number; max: number } | null
  assumptions: string[]
  physical_product_tested: false
  batch_consistency_established: false
}

export type MixVolumeBasis = 'external_volume' | 'solid_volume' | 'other' | 'unknown'
export type MixAmountUnit = 'g' | 'mass_percent' | 'volume_percent'
export type MixCase = {
  label: string
  components: {
    name: string
    role: 'main' | 'binder' | 'other'
    amount: number
    unit: MixAmountUnit
  }[]
  amount_basis: string
  process: string
  density_method: string
  density_volume_basis: MixVolumeBasis
  calculation_volume_basis: MixVolumeBasis
  volume_basis_details: string
}
export type MixReading = {
  id: string
  value_g_cm3: number
  reading_kind: 'unknown' | 'specimen' | 'repeat'
  batch_id: string | null
  run_id: string | null
  specimen_id: string | null
  repeat_of: string | null
}
export type MixMassResult = {
  result_kind: 'simulation'
  input_kind: 'my_mix'
  product_name: string
  property: 'mass'
  case: MixCase
  case_fingerprint: string
  volume_cm3: number
  target_min_kg: number
  target_max_kg: number
  reading_scenarios: (MixReading & { mass_kg: number; inside_target: boolean })[]
  density_mean_g_cm3: number
  mean_density_mass_kg: number
  observed_mass_min_kg: number
  observed_mass_max_kg: number
  readings_in_target: number
  reading_count: number
  grouping: {
    identified_batch_count: number
    unknown_batch_reading_count: number
    repeat_reading_count: number
    batch_groups: {
      batch_id: string
      reading_count: number
      mass_min_kg: number
      mass_max_kg: number
    }[]
    run_groups: {
      batch_id: string | null
      run_id: string
      reading_count: number
      mass_min_kg: number
      mass_max_kg: number
    }[]
    specimen_groups: {
      batch_id: string | null
      run_id: string | null
      specimen_id: string
      reading_count: number
      mass_min_kg: number
      mass_max_kg: number
    }[]
  }
  assumptions: string[]
  physical_product_tested: false
  batch_consistency_established: false
}
