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
