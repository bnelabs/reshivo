"""Validated workbench operations and local experiment storage."""
from dataclasses import asdict, fields
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import uuid
from urllib.parse import quote

from .cli import LIMITS, export_design, load_config, report_text
from .materials import ROOT, SOURCE_URL, load_materials, verify_sources
from .mechanics import Requirements, Section, evaluate
from .search import SearchSpace, search


class ServiceError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _object(value, name):
    if not isinstance(value, dict):
        raise ServiceError("invalid_request", f"{name} must be an object")
    return value


def _allowed(value, names, name):
    _object(value, name)
    if set(value) - set(names):
        raise ServiceError("invalid_request", f"Unsupported {name} fields")


def _numeric_values(value, cls, defaults, name):
    _allowed(value, [field.name for field in fields(cls)], name)
    for number in value.values():
        if isinstance(number, bool) or not isinstance(number, (int, float)):
            raise ServiceError("invalid_request", f"{name} values must be numbers")
        if not math.isfinite(number) or not 0 < number <= 1_000_000:
            raise ServiceError("invalid_request", f"{name} values must be positive, finite and at most 1000000")
    try:
        return cls(**{**defaults, **value})
    except (ValueError, TypeError, OverflowError) as exc:
        raise ServiceError("invalid_request", str(exc)) from None


class WorkbenchService:
    def __init__(self, root=ROOT, output_root=None, meta_status_fn=None, proposal_fn=None, advisor_fn=None, trial_fn=None, assist_fn=None, note_fn=None, engineering_note_fn=None, followup_fn=None, intake_fn=None):
        self.root = Path(root).resolve()
        self.output_root = Path(output_root or self.root / "outputs/workbench").resolve()
        self.config, self.default_requirements, self.default_search = load_config(self.root / "examples/support-member.json")
        self.meta_status_fn = meta_status_fn
        self.proposal_fn = proposal_fn
        self.advisor_fn = advisor_fn
        self.followup_fn = followup_fn
        self.trial_fn = trial_fn
        self.assist_fn = assist_fn
        self.note_fn = note_fn
        self.engineering_note_fn = engineering_note_fn
        self.intake_fn = intake_fn

    def inference_providers(self):
        from .providers import provider_catalog, provider_settings, ProviderConfigurationError
        try:
            return {"catalog": provider_catalog(), "settings": provider_settings(self.root)}
        except ProviderConfigurationError as error:
            raise ServiceError("provider_configuration", str(error)) from None

    def inference_settings(self, request, action):
        from .providers import save_provider_settings, select_provider_settings, clear_provider_settings, ProviderConfigurationError
        try:
            _object(request, "Connection settings")
            if action == "save":
                return save_provider_settings(request, root=self.root)
            _allowed(request, {"provider"}, "Connection settings")
            if action == "select":
                return select_provider_settings(request.get("provider"), root=self.root)
            return clear_provider_settings(request.get("provider"), root=self.root)
        except ProviderConfigurationError as error:
            raise ServiceError("provider_configuration", str(error)) from None

    def save_inference_settings(self, request):
        return self.inference_settings(request, "save")

    def select_inference_settings(self, request):
        return self.inference_settings(request, "select")

    def clear_inference_settings(self, request):
        return self.inference_settings(request, "clear")

    def project_intake(self, request):
        from .project_intake import read_project_intake, validate_intake_request
        from .meta import MetaAPIError, MetaConfigurationError, MetaValidationError
        from .products import ProductInputError
        try:
            validate_intake_request(request)
            return self.intake_fn(request) if self.intake_fn else read_project_intake(request, root=self.root)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None
        except MetaConfigurationError as error:
            raise ServiceError("provider_not_configured", str(error), 503) from None
        except MetaValidationError as error:
            raise ServiceError("invalid_model_response", str(error), 502) from None
        except MetaAPIError as error:
            raise ServiceError("provider_request_failed", str(error), 502) from None

    def project_planning_mode(self, request):
        """Classify only bounded, user-entered fields without contacting a provider."""
        from .unknown_metal_planning import needs_local_metal_planning
        brief_fields = {"input", "variation", "contamination", "product", "use_case", "targets", "process", "available_changes"}
        _allowed(request, {"brief", "question", "project_context", "history"}, "planning-mode request")
        if not {"brief", "question", "project_context"} <= set(request):
            raise ServiceError("invalid_request", "Include the project brief, question and configurations.")
        brief = request["brief"]
        _allowed(brief, brief_fields, "project brief")
        if set(brief) != brief_fields or any(not isinstance(value, str) or len(value) > 3000 for value in brief.values()):
            raise ServiceError("invalid_request", "Include each project detail as text of at most 3000 characters.")
        if not isinstance(request["question"], str) or len(request["question"]) > 3000:
            raise ServiceError("invalid_request", "Keep the question within 3000 characters.")
        history = request.get("history", [])
        if not isinstance(history, list) or len(history) > 6:
            raise ServiceError("invalid_request", "Include at most six recent user messages.")
        for entry in history:
            _allowed(entry, {"role", "content"}, "history message")
            if (set(entry) != {"role", "content"} or entry["role"] != "user" or not isinstance(entry["content"], str)
                    or len(entry["content"]) > 6000):
                raise ServiceError("invalid_request", "History may contain only bounded user messages.")
        context = request["project_context"]
        _allowed(context, {"configurations"}, "planning context")
        if set(context) != {"configurations"} or not isinstance(context["configurations"], list) or len(context["configurations"]) > 100:
            raise ServiceError("invalid_request", "Include up to 100 captured setup versions.")
        identities = set()
        for configuration in context["configurations"]:
            _allowed(configuration, {"id", "revision", "materials", "process", "geometry"}, "setup")
            if set(configuration) != {"id", "revision", "materials", "process", "geometry"}:
                raise ServiceError("invalid_request", "Include each setup's identifier, version, materials, process and shape.")
            identity, revision = configuration["id"], configuration["revision"]
            if (not isinstance(identity, str) or not identity.strip() or len(identity) > 160 or isinstance(revision, bool)
                    or not isinstance(revision, int) or not 0 <= revision <= 1_000_000_000 or (identity, revision) in identities):
                raise ServiceError("invalid_request", "Use unique setup identifiers and valid version numbers.")
            identities.add((identity, revision))
            if any(not isinstance(configuration[field], str) or len(configuration[field]) > 2000 for field in ("process", "geometry")):
                raise ServiceError("invalid_request", "Keep each setup's process and shape within 2000 characters.")
            materials = configuration["materials"]
            if not isinstance(materials, list) or len(materials) > 50:
                raise ServiceError("invalid_request", "Include up to 50 materials in each setup.")
            for material in materials:
                _allowed(material, {"name"}, "material")
                if set(material) != {"name"} or not isinstance(material["name"], str) or len(material["name"]) > 160:
                    raise ServiceError("invalid_request", "Keep each material name within 160 characters.")
        return {"planning_only": bool(needs_local_metal_planning(request))}

    def manufacturing_cost(self, request):
        from .manufacturing_cost import calculate_manufacturing_cost
        return calculate_manufacturing_cost(request)

    def compare_manufacturing_costs(self, request):
        from .manufacturing_cost import compare_manufacturing_costs
        _allowed(request, {"records"}, "Cost comparison")
        return compare_manufacturing_costs(request.get("records"))

    def trial_records(self, request):
        from .trial_records import assess_trial_records
        return assess_trial_records(request)

    def compare_project_decisions(self, request):
        from .decision_comparison import compare_project_decisions
        from .products import ProductInputError
        try:
            return compare_project_decisions(request)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None

    def meta_status(self):
        if self.meta_status_fn is not None:
            status = self.meta_status_fn()
        else:
            try:
                from .meta import meta_status
                status = meta_status()
            except ImportError:
                status = {"configured": False, "model": "muse-spark-1.3"}
        return {"configured": bool(status.get("configured")), "model": str(status.get("model", "muse-spark-1.3"))}

    def _materials(self):
        try:
            return load_materials(self.root)
        except (ValueError, OSError, KeyError):
            raise ServiceError("source_unavailable", "The material data could not be loaded or did not match the saved source files", 503) from None

    def bootstrap(self):
        return {
            "schema_version": 1,
            "materials": [material.to_dict() for material in self._materials()],
            "config": self.config,
            "limits": LIMITS,
            "source": {"url": SOURCE_URL, "license": "CC-BY-4.0"},
            "meta": self.meta_status(),
        }

    def health(self):
        try:
            self._materials()
            source_available = True
        except ServiceError:
            source_available = False
        return {"status": "ok" if source_available else "degraded", "source_available": source_available, "meta": self.meta_status()}

    def advisor_status(self):
        if self.meta_status_fn is not None:
            return self.meta_status()
        from .advisor import advisor_status
        return advisor_status(self.root)

    def advisor_help(self, request):
        from .advisor import help_with_case, validate_request
        from .meta import MetaAPIError, MetaConfigurationError, MetaValidationError
        from .products import ProductInputError
        try:
            validate_request(request)
            if self.advisor_fn is not None:
                return self.advisor_fn(request)
            return help_with_case(request, root=self.root)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None
        except MetaConfigurationError as error:
            raise ServiceError("meta_not_configured", str(error), 503) from None
        except MetaValidationError as error:
            raise ServiceError("meta_invalid_response", str(error), 502) from None
        except MetaAPIError as error:
            raise ServiceError("meta_request_failed", str(error), 502) from None

    def advisor_follow_up(self, request):
        from .advisor import follow_up_with_case, validate_request
        from .meta import MetaAPIError, MetaConfigurationError, MetaValidationError
        from .products import ProductInputError
        try:
            validate_request(request)
            if self.followup_fn is not None:
                return self.followup_fn(request)
            return follow_up_with_case(request, root=self.root)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None
        except MetaConfigurationError as error:
            raise ServiceError("meta_not_configured", str(error), 503) from None
        except MetaValidationError as error:
            raise ServiceError("meta_invalid_response", str(error), 502) from None
        except MetaAPIError as error:
            raise ServiceError("meta_request_failed", str(error), 502) from None

    def advisor_mass_trim(self, request):
        from .advisor import mass_trim
        from .products import ProductInputError
        try:
            return mass_trim(request)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None

    def advisor_inspect_image(self, request):
        from .image_intake import inspect_image
        from .meta import MetaAPIError, MetaConfigurationError, MetaValidationError
        from .products import ProductInputError
        try:
            return inspect_image(request, root=self.root)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None
        except MetaConfigurationError as error:
            raise ServiceError("meta_not_configured", str(error), 503) from None
        except MetaValidationError as error:
            raise ServiceError("meta_invalid_response", str(error), 502) from None
        except MetaAPIError as error:
            raise ServiceError("meta_request_failed", str(error), 502) from None

    def advisor_read_observation(self, request):
        from .observation_intake import read_observation_note, validate_note_request
        from .meta import MetaAPIError, MetaConfigurationError, MetaValidationError
        from .products import ProductInputError
        try:
            validate_note_request(request)
            if self.note_fn is not None:
                return self.note_fn(request)
            return read_observation_note(request, root=self.root)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None
        except MetaConfigurationError as error:
            raise ServiceError("meta_not_configured", str(error), 503) from None
        except MetaValidationError as error:
            raise ServiceError("meta_invalid_response", str(error), 502) from None
        except MetaAPIError as error:
            raise ServiceError("meta_request_failed", str(error), 502) from None

    def advisor_trial(self, request):
        from .advisor import plan_trial, validate_trial_request
        from .meta import MetaAPIError, MetaConfigurationError, MetaValidationError
        from .products import ProductInputError
        try:
            validate_trial_request(request)
            if self.trial_fn is not None:
                return self.trial_fn(request)
            return plan_trial(request, root=self.root)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None
        except MetaConfigurationError as error:
            raise ServiceError("meta_not_configured", str(error), 503) from None
        except MetaValidationError as error:
            raise ServiceError("meta_invalid_response", str(error), 502) from None
        except MetaAPIError as error:
            raise ServiceError("meta_request_failed", str(error), 502) from None

    def advisor_read_engineering_note(self, request):
        from .engineering_intake import read_engineering_note, validate_engineering_request
        from .meta import MetaAPIError, MetaConfigurationError, MetaValidationError
        from .products import ProductInputError
        try:
            validate_engineering_request(request)
            if self.engineering_note_fn is not None:
                return self.engineering_note_fn(request)
            return read_engineering_note(request, root=self.root)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None
        except MetaConfigurationError as error:
            raise ServiceError("meta_not_configured", str(error), 503) from None
        except MetaValidationError as error:
            raise ServiceError("meta_invalid_response", str(error), 502) from None
        except MetaAPIError as error:
            raise ServiceError("meta_request_failed", str(error), 502) from None

    def advisor_balance_mix(self, request):
        from .advisor import balance_mix
        from .products import ProductInputError
        try:
            return balance_mix(request)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None

    def adaptation_plan(self, request):
        from .adaptation import plan_adaptation
        from .products import ProductInputError
        try:
            return plan_adaptation(request)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None

    def adaptation_feedback(self, request):
        from .adaptation import adjust_from_measurement
        from .products import ProductInputError
        try:
            return adjust_from_measurement(request)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None

    def adaptation_assist(self, request):
        from .engineering_agent import assist_with_adaptation, validate_assist_request
        from .meta import MetaAPIError, MetaConfigurationError, MetaValidationError
        from .products import ProductInputError
        try:
            validate_assist_request(request)
            if self.assist_fn is not None:
                return self.assist_fn(request)
            return assist_with_adaptation(request, root=self.root)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None
        except MetaConfigurationError as error:
            raise ServiceError("meta_not_configured", str(error), 503) from None
        except MetaValidationError as error:
            raise ServiceError("meta_invalid_response", str(error), 502) from None
        except MetaAPIError as error:
            raise ServiceError("meta_request_failed", str(error), 502) from None

    def adaptation_observed_mass(self, request):
        from .adaptation import adjust_observed_mass
        from .products import ProductInputError
        try:
            return adjust_observed_mass(request)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None

    def adaptation_balance(self, request):
        from .balance import plan_shared_balance
        from .products import ProductInputError
        try:
            return plan_shared_balance(request)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None

    def adaptation_apply_engineering_note(self, request):
        from .balance import plan_shared_balance
        from .engineering_intake import normalize_engineering_fields, prepare_engineering_draft
        from .meta import MetaValidationError
        from .products import ProductInputError
        try:
            required = {"brief", "calculation_context", "note", "source_fields", "request_fingerprint", "draft_fingerprint",
                        "review_confirmed", "independent_adjustments", "target_choice"}
            if not isinstance(request, dict) or set(request) != required:
                raise ProductInputError("Include exactly the current case, note, source fields, draft fingerprints and review choices")
            if type(request["review_confirmed"]) is not bool or type(request["independent_adjustments"]) is not bool:
                raise ProductInputError("Review and independent-adjustment confirmations must be explicit booleans")
            if request["target_choice"] not in ("current", "proposed"):
                raise ProductInputError("Explicitly choose current or proposed targets")
            case = {key: request[key] for key in ("brief", "calculation_context", "note")}
            draft = normalize_engineering_fields(case, request["source_fields"])
            if any(request[key] != draft[key] for key in ("request_fingerprint", "draft_fingerprint")):
                raise ProductInputError("The case, note or source-linked draft changed; read and review it again")
            prepared = prepare_engineering_draft(case, draft, review_confirmed=request["review_confirmed"],
                                                independent_adjustments=request["independent_adjustments"], target_choice=request["target_choice"])
            reviewed = request["review_confirmed"] and request["independent_adjustments"]
            return {**prepared, "reviewed_values": draft["values"] if reviewed else None,
                    "check": plan_shared_balance(prepared["bound_request"]) if prepared["ready"] else None}
        except (ProductInputError, MetaValidationError) as error:
            raise ServiceError("invalid_request", str(error)) from None

    def product_catalog(self):
        from .products import ProductDataError, product_catalog
        try:
            return product_catalog(self.root)
        except ProductDataError as error:
            raise ServiceError("source_unavailable", str(error), 503) from None

    def counterweight(self, request):
        from .products import ProductDataError, ProductInputError, counterweight
        try:
            return counterweight(request, self.root)
        except ProductDataError as error:
            raise ServiceError("source_unavailable", str(error), 503) from None
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None

    def my_mix_mass(self, request):
        from .mix_mass import my_mix_mass
        from .products import ProductInputError
        try:
            return my_mix_mass(request)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None

    def target_series(self):
        from .products import ProductDataError
        from .target_checks import target_series
        try:
            return target_series(self.root)
        except ProductDataError as error:
            raise ServiceError("source_unavailable", str(error), 503) from None

    def target_check(self, request):
        from .products import ProductDataError, ProductInputError
        from .target_checks import target_check
        try:
            return target_check(request, self.root)
        except ProductDataError as error:
            raise ServiceError("source_unavailable", str(error), 503) from None
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None

    def compare_readings(self, request):
        from .products import ProductInputError
        from .reading_comparison import compare_readings
        try:
            return compare_readings(request)
        except ProductInputError as error:
            raise ServiceError("invalid_request", str(error)) from None

    def _parameters(self, request, names, allow_all=False):
        _allowed(request, names, "request")
        material_id = request.get("material_id", "04441PP-REG(1)-1E1")
        if not isinstance(material_id, str):
            raise ServiceError("invalid_request", "Choose a material from the list")
        materials = self._materials()
        if allow_all and material_id == "all":
            chosen = materials
        else:
            chosen = [material for material in materials if material.id == material_id]
        if not chosen:
            raise ServiceError("invalid_request", "This material is not available")
        scenario = request.get("scenario", "lower_sensitivity")
        if scenario not in ("nominal", "lower_sensitivity"):
            raise ServiceError("invalid_request", "Choose measured averages or a lower estimate")
        requirements = _numeric_values(request.get("requirements", {}), Requirements, asdict(self.default_requirements), "requirements")
        return chosen, scenario, requirements

    def run_experiment(self, request):
        materials, scenario, requirements = self._parameters(request, {"material_id", "scenario", "requirements", "search"}, allow_all=True)
        space = _numeric_values(request.get("search", {}), SearchSpace, asdict(self.default_search), "search")
        try:
            results = [search(material, requirements, space, scenario) for material in materials]
        except (ValueError, TypeError, OverflowError) as exc:
            raise ServiceError("invalid_request", str(exc)) from None
        identity = str(uuid.uuid4())
        folder = self.output_root / identity
        folder.mkdir(parents=True, exist_ok=False)
        exports = []
        artifact_names = ["report.md", "results.json"]
        for material, result in zip(materials, results):
            for entry in export_design(folder, material, result, requirements):
                design = json.loads((folder / entry["design"]).read_text())
                prefix = f"/api/experiments/{identity}/artifacts/"
                exports.append({
                    "material_id": material.id,
                    "family": entry["family"],
                    "section": design["section"],
                    "evaluation": design["evaluation"],
                    "outline": Section(**design["section"]).outline(),
                    "stl_url": prefix + quote(entry["stl"], safe=""),
                    "design_url": prefix + quote(entry["design"], safe=""),
                })
                artifact_names.extend([entry["stl"], entry["design"]])
        response = {
            "id": identity,
            "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "requirements": asdict(requirements),
            "search": asdict(space),
            "scenario": scenario,
            "results": results,
            "exports": exports,
            "report_url": f"/api/experiments/{identity}/artifacts/report.md",
            "results_url": f"/api/experiments/{identity}/artifacts/results.json",
            "limits": LIMITS,
            "source": {"url": SOURCE_URL, "license": "CC-BY-4.0"},
            "meta_model_used": False,
        }
        (folder / "results.json").write_text(json.dumps(response, indent=2, allow_nan=False) + "\n")
        (folder / "report.md").write_text(report_text(results, requirements, scenario))
        (folder / "artifact_manifest.json").write_text(json.dumps({"id": identity, "files": artifact_names}, indent=2) + "\n")
        return response

    def evaluate_candidate(self, request):
        materials, scenario, requirements = self._parameters(request, {"material_id", "scenario", "requirements", "section"})
        raw_section = _object(request.get("section"), "section")
        _allowed(raw_section, {field.name for field in fields(Section)}, "section")
        for name in ("width_mm", "height_mm", "flange_mm", "web_mm"):
            number = raw_section.get(name)
            if number is not None and (isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or not 0 < number <= 1_000_000):
                raise ServiceError("invalid_request", "Section dimensions must be positive finite numbers")
        try:
            section = Section(**raw_section)
            state = materials[0].scenario(scenario)
            response = evaluate(section, requirements, state["modulus_MPa"], state["yield_stress_MPa"])
        except (ValueError, TypeError, OverflowError) as exc:
            raise ServiceError("invalid_request", str(exc)) from None
        return {
            "material_id": materials[0].id,
            "material_scenario": state,
            "requirements": asdict(requirements),
            "section": section.to_dict(),
            "outline": section.outline(),
            "evaluation": response,
            "limits": LIMITS,
            "meta_model_used": False,
        }

    def propose(self, request):
        materials, scenario, requirements = self._parameters(request, {"material_id", "scenario", "requirements", "max_candidates"})
        count = request.get("max_candidates", 4)
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 6:
            raise ServiceError("invalid_request", "Request between 1 and 6 design ideas")
        if self.proposal_fn is not None:
            result = self.proposal_fn(materials[0], requirements, scenario, max_candidates=count)
            return self._save_proposals(result, materials[0], requirements)
        try:
            from .meta import MetaAPIError, MetaConfigurationError, MetaValidationError, propose_and_evaluate
        except ImportError:
            raise ServiceError("meta_unavailable", "Meta generation is not configured; add MODEL_API_KEY to the local .env file", 503) from None
        try:
            result = propose_and_evaluate(materials[0], requirements, scenario_name=scenario, max_candidates=count)
            return self._save_proposals(result, materials[0], requirements)
        except MetaConfigurationError as exc:
            raise ServiceError("meta_not_configured", str(exc), 503) from None
        except MetaValidationError as exc:
            raise ServiceError("meta_invalid_response", str(exc), 502) from None
        except MetaAPIError as exc:
            raise ServiceError("meta_request_failed", str(exc), 502) from None

    def _save_proposals(self, result, material, requirements):
        identity = str(uuid.uuid4())
        folder = self.output_root / identity
        folder.mkdir(parents=True, exist_ok=False)
        names = ["report.md", "results.json"]
        prefix = f"/api/experiments/{identity}/artifacts/"
        lines = ["# ReMatter Meta design ideas", "", "Generated ideas checked with a bending model. The designs have not been physically tested.", "", f"Model: {result['model']}. Generated in this run: {result['live']}.", "", f"Material: {material.id}. [Material test data, CC BY 4.0]({SOURCE_URL}).", "", result["material_scenario"]["interpretation"], ""]
        for candidate in result["candidates"]:
            evaluation = candidate["evaluation"]
            if evaluation["passes_declared_screens"]:
                nested = {"material_scenario": result["material_scenario"], "families": {candidate["id"]: {"best": {"section": candidate["section"], "evaluation": evaluation}}}}
                entry = export_design(folder, material, nested, requirements)[0]
                names.extend([entry["stl"], entry["design"]])
                candidate["stl_url"] = prefix + quote(entry["stl"], safe="")
                candidate["design_url"] = prefix + quote(entry["design"], safe="")
            lines.extend([f"## {candidate['name']}", "", candidate["rationale"], "", "```json", json.dumps({"section": candidate["section"], "evaluation": evaluation}, indent=2), "```", ""])
        lines.extend(["## What this model covers", ""] + ["- " + item for item in result["limits"]])
        result.update({"id": identity, "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "meta_model_used": bool(result["live"]), "report_url": prefix + "report.md", "results_url": prefix + "results.json"})
        (folder/"report.md").write_text("\n".join(lines) + "\n")
        (folder/"results.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
        (folder/"artifact_manifest.json").write_text(json.dumps({"id": identity, "files": names}, indent=2) + "\n")
        return result

    def _folder(self, identity):
        try:
            if str(uuid.UUID(identity)) != identity:
                raise ValueError
        except (ValueError, TypeError, AttributeError):
            raise ServiceError("not_found", "Design run not found", 404) from None
        folder = (self.output_root / identity).resolve()
        if folder.parent != self.output_root or not folder.is_dir():
            raise ServiceError("not_found", "Design run not found", 404)
        return folder

    def get_experiment(self, identity):
        folder = self._folder(identity)
        try:
            return json.loads((folder / "results.json").read_text())
        except (OSError, ValueError):
            raise ServiceError("not_found", "Design run not found", 404) from None

    def get_artifact(self, identity, filename):
        folder = self._folder(identity)
        if filename != Path(filename).name or filename in {"", ".", ".."} or "\\" in filename:
            raise ServiceError("not_found", "Download not found", 404)
        try:
            manifest = json.loads((folder / "artifact_manifest.json").read_text())
        except (OSError, ValueError):
            raise ServiceError("not_found", "Download not found", 404) from None
        path = (folder / filename).resolve()
        if filename not in manifest.get("files", []) or path.parent != folder or not path.is_file():
            raise ServiceError("not_found", "Download not found", 404)
        return path
