"""Assess entered property readings against exact, versioned configurations."""

from decimal import Decimal, InvalidOperation
import re


_NUMBER = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")
_KINDS = ("synthetic", "user_reported")
_LIMITS = {"configurations": 100, "checks": 50, "records": 1000, "materials": 50, "readings": 1000}


def _decimal_text(value):
    if value is None:
        return None
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


class _Assessment:
    def __init__(self, request):
        self.request = request if isinstance(request, dict) else {}
        self.errors = []
        self.questions = []
        self.warnings = []
        self.configs = {}
        self.current = {}
        self.checks = {}
        self.records = []
        self.ignored = []
        self.total_readings = 0
        if not isinstance(request, dict):
            self.error("request", "object_required", "Enter one trial-record object.")

    def error(self, field, code, message):
        self.errors.append({"field": field, "code": code, "message": message})

    def ask(self, field, question):
        if not any(item["field"] == field for item in self.questions):
            self.questions.append({"field": field, "question": question})

    def text(self, value, field, *, optional=False, limit=160):
        if optional and (value is None or value == ""):
            return None
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            self.error(field, "text_required", "Use a nonempty text value of at most " + str(limit) + " characters.")
            return None
        return value

    def array(self, value, field, category):
        if not isinstance(value, list):
            self.error(field, "list_required", "Enter a list of " + category + ".")
            return []
        if len(value) > _LIMITS[category]:
            self.error(field, "too_many_entries", "This list exceeds its " + str(_LIMITS[category]) + " entry limit.")
            return []
        return value

    def number(self, value, field, *, optional=False):
        if optional and (value is None or value == ""):
            return None
        if not isinstance(value, str) or len(value) > 160 or not _NUMBER.fullmatch(value):
            self.error(field, "decimal_string_required", "Use a finite decimal string of at most 160 characters.")
            return None
        try:
            result = Decimal(value)
        except InvalidOperation:
            self.error(field, "decimal_string_required", "Use a finite decimal string.")
            return None
        if not result.is_finite() or abs(result.as_tuple().exponent) > 1000 or (result and abs(result.adjusted()) > 1000):
            self.error(field, "number_out_of_bounds", "Use a finite number with decimal exponents between -1000 and 1000.")
            return None
        return result

    def revision(self, value, field):
        if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 1_000_000_000:
            self.error(field, "revision_required", "Use a nonnegative integer configuration revision.")
            return None
        return value

    def configurations(self):
        invalid_percentages = []
        for index, item in enumerate(self.array(self.request.get("configurations", []), "configurations", "configurations")):
            field = "configurations." + str(index)
            if not isinstance(item, dict):
                self.error(field, "object_required", "Each configuration must be an object.")
                continue
            identifier = self.text(item.get("id"), field + ".id")
            revision = self.revision(item.get("revision"), field + ".revision")
            name = self.text(item.get("name"), field + ".name")
            materials = []
            amount_complete = True
            seen = set()
            for material_index, material in enumerate(self.array(item.get("materials", []), field + ".materials", "materials")):
                material_field = field + ".materials." + str(material_index)
                if not isinstance(material, dict):
                    self.error(material_field, "object_required", "Each named stock must be an object.")
                    amount_complete = False
                    continue
                mid = self.text(material.get("id"), material_field + ".id")
                mname = self.text(material.get("name"), material_field + ".name")
                if mid is not None and mid in seen:
                    self.error(material_field + ".id", "duplicate_material", "Named stock IDs must be unique within a configuration.")
                seen.add(mid)
                raw_amount = material.get("amount")
                raw_unit = material.get("unit")
                unit = self.text(raw_unit, material_field + ".unit", optional=True)
                amount = None
                invalid_percentage = False
                numeric_amount = (raw_amount.strip() if isinstance(raw_amount, str)
                                  and unit in ("mass_percent", "volume_percent") else raw_amount)
                if raw_amount is not None and raw_amount != "":
                    if not isinstance(raw_amount, str) or len(raw_amount) > 160:
                        self.error(material_field + ".amount", "amount_text_required", "Capture an exact amount or short unknown-context text.")
                    elif _NUMBER.fullmatch(numeric_amount):
                        amount = self.number(numeric_amount, material_field + ".amount")
                        if amount is not None and amount < 0:
                            self.error(material_field + ".amount", "negative_amount", "A captured component amount cannot be negative.")
                            amount = None
                        elif amount is not None and unit in ("mass_percent", "volume_percent") and amount > 100:
                            # Keep older configurations accessible after a corrected version is saved.
                            invalid_percentages.append((identifier, revision, material_field + ".amount"))
                            invalid_percentage = True
                            amount = None
                known = amount is not None and unit is not None
                amount_complete = amount_complete and known
                if not known and not invalid_percentage:
                    self.ask(material_field + ".amount", "What is this stock's amount and quantity basis? Unknown context can remain captured.")
                materials.append({"id": mid, "name": mname, "amount": raw_amount, "unit": raw_unit, "amount_known": known})
            if not materials:
                amount_complete = False
                self.ask(field + ".materials", "Which named stocks and amounts describe this configuration?")
            process = self.text(item.get("process"), field + ".process", optional=True, limit=2000)
            geometry = self.text(item.get("geometry"), field + ".geometry", optional=True, limit=2000)
            notes = self.text(item.get("notes"), field + ".notes", optional=True, limit=2000)
            if not process:
                self.ask(field + ".process", "Which preparation/process conditions describe this configuration?")
            if not geometry:
                self.ask(field + ".geometry", "Which relevant specimen/product geometry or installation conditions describe it?")
            if identifier is None or revision is None:
                continue
            key = (identifier, revision)
            if key in self.configs:
                self.error(field, "duplicate_configuration_version", "Each configuration ID/revision pair must be unique.")
                continue
            self.configs[key] = {"id": identifier, "revision": revision, "name": name, "materials": materials, "process": process, "geometry": geometry, "notes": notes, "component_amounts_complete": amount_complete, "formulation_completeness": "not_assessed", "can_prepare_quantities": False}
            if identifier not in self.current or revision > self.current[identifier]:
                self.current[identifier] = revision
        for identifier, revision, field in invalid_percentages:
            if self.current.get(identifier) == revision:
                self.error(field, "percentage_above_100", "A material percentage cannot be more than 100%.")
        if not self.configs:
            self.ask("configurations", "Capture at least one named full configuration; incomplete amounts can remain unknown.")

    def check_specs(self):
        for index, item in enumerate(self.array(self.request.get("checks", []), "checks", "checks")):
            field = "checks." + str(index)
            if not isinstance(item, dict):
                self.error(field, "object_required", "Each property check must be an object.")
                continue
            identifier = self.text(item.get("id"), field + ".id")
            name = self.text(item.get("name"), field + ".name")
            unit = self.text(item.get("unit"), field + ".unit")
            method = self.text(item.get("method"), field + ".method", limit=2000)
            required = item.get("required")
            if not isinstance(required, bool):
                self.error(field + ".required", "boolean_required", "Mark whether this check is required using true or false.")
            minimum = self.number(item.get("minimum"), field + ".minimum", optional=True)
            maximum = self.number(item.get("maximum"), field + ".maximum", optional=True)
            if minimum is not None and maximum is not None and minimum > maximum:
                self.error(field, "reversed_limits", "Minimum cannot exceed maximum.")
            if identifier is None:
                continue
            if identifier in self.checks:
                self.error(field + ".id", "duplicate_check", "Property check IDs must be unique and retain their meaning.")
                continue
            self.checks[identifier] = {"id": identifier, "name": name, "unit": unit, "method": method, "required": required is True, "minimum": minimum, "maximum": maximum}

    def reading_entries(self, item, field):
        result = []
        values = self.array(item.get("readings", []), field + ".readings", "readings")
        self.total_readings += len(values)
        if self.total_readings > 10000:
            self.error(field + ".readings", "too_many_readings", "Use at most 10000 readings in one assessment.")
            return []
        seen = {}
        for index, reading in enumerate(values):
            rfield = field + ".readings." + str(index)
            if not isinstance(reading, dict):
                self.error(rfield, "object_required", "Each reading must be an object.")
                continue
            value = self.number(reading.get("value"), rfield + ".value")
            entry = {"value": reading.get("value"), "number": value}
            for key in ("reading_id", "specimen_id", "run_id", "batch_id", "repeat_of"):
                entry[key] = self.text(reading.get(key), rfield + "." + key, optional=True)
            rid = entry["reading_id"]
            if rid is not None and rid in seen:
                self.error(rfield + ".reading_id", "duplicate_reading", "Reading IDs must be unique within a record.")
            if rid is not None:
                seen[rid] = entry
            result.append(entry)
        for entry in result:
            repeat = entry["repeat_of"]
            if repeat is None:
                continue
            if repeat not in seen:
                self.error(field + ".readings", "repeat_reference_missing", "repeat_of must name an entered reading in this same record.")
                continue
            parent = seen[repeat]
            if entry["specimen_id"] and parent["specimen_id"] and entry["specimen_id"] != parent["specimen_id"]:
                self.error(field + ".readings", "repeat_specimen_conflict", "A repeated reading cannot identify a different known specimen.")
            visited = set()
            cursor = entry
            while cursor.get("repeat_of") in seen:
                target = cursor["repeat_of"]
                if target in visited:
                    self.error(field + ".readings", "repeat_cycle", "Repeated-reading references must not form a cycle.")
                    break
                visited.add(target)
                cursor = seen[target]
        return result

    def record_entries(self, case_id, kind):
        seen = set()
        for index, item in enumerate(self.array(self.request.get("records", []), "records", "records")):
            field = "records." + str(index)
            start_errors = len(self.errors)
            if not isinstance(item, dict):
                self.error(field, "object_required", "Each property record must be an object.")
                continue
            rid = self.text(item.get("id"), field + ".id")
            cid = self.text(item.get("configuration_id"), field + ".configuration_id")
            revision = self.revision(item.get("configuration_revision"), field + ".configuration_revision")
            check_id = self.text(item.get("check_id"), field + ".check_id")
            record_case = self.text(item.get("case_id"), field + ".case_id")
            if record_case != case_id:
                self.error(field + ".case_id", "foreign_case", "A record from another or unknown case cannot enter this assessment.")
            if rid is not None and rid in seen:
                self.error(field + ".id", "duplicate_record", "Record IDs must be unique; do not count a record twice.")
            if rid is not None:
                seen.add(rid)
            if cid is not None and revision is not None and (cid, revision) not in self.configs:
                self.error(field, "configuration_reference_missing", "The exact referenced configuration ID/revision must be captured.")
            if check_id is not None and check_id not in self.checks:
                self.error(field + ".check_id", "check_reference_missing", "The referenced property check must exist.")
            data_kind = item.get("data_kind")
            if data_kind not in _KINDS:
                self.error(field + ".data_kind", "data_kind_required", "Choose synthetic or user_reported evidence explicitly.")
            confirmed = item.get("conditions_confirmed")
            if not isinstance(confirmed, bool):
                self.error(field + ".conditions_confirmed", "boolean_required", "Explicitly confirm whether the record matches this configuration and check conditions.")
            unit = self.text(item.get("unit"), field + ".unit")
            method = self.text(item.get("method"), field + ".method", limit=2000)
            check = self.checks.get(check_id)
            if check and unit != check["unit"]:
                self.error(field + ".unit", "unit_mismatch", "Record and check units must match exactly; readings are never relabelled or converted.")
            if check and method != check["method"]:
                self.error(field + ".method", "method_mismatch", "Record and check methods must match exactly; conditions cannot be pooled across methods.")
            readings = self.reading_entries(item, field)
            if not readings:
                self.ask(field + ".readings", "What readings were entered for this record? An empty record cannot complete a required check.")
            record = {"id": rid, "case_id": record_case, "configuration_id": cid, "configuration_revision": revision, "check_id": check_id, "unit": unit, "method": method, "data_kind": data_kind, "conditions_confirmed": confirmed, "readings": readings, "valid": len(self.errors) == start_errors}
            if not record["valid"]:
                self.ignored.append({"record_id": rid, "reason": "invalid_record"})
            elif data_kind != kind:
                self.ignored.append({"record_id": rid, "reason": "other_data_kind", "data_kind": data_kind})
            elif self.current.get(cid) != revision:
                self.ignored.append({"record_id": rid, "reason": "stale_configuration_revision", "configuration_revision": revision, "current_revision": self.current.get(cid)})
            else:
                self.records.append(record)

    def assess_check(self, configuration, check, kind):
        candidates = [record for record in self.records if record["configuration_id"] == configuration["id"] and record["configuration_revision"] == configuration["revision"] and record["check_id"] == check["id"]]
        usable = [record for record in candidates if record["conditions_confirmed"] is True and record["readings"]]
        values = [reading["number"] for record in usable for reading in record["readings"]]
        review = any(record["conditions_confirmed"] is not True or not record["readings"] for record in candidates)
        target_set = check["minimum"] is not None or check["maximum"] is not None
        outside = any((check["minimum"] is not None and value < check["minimum"]) or (check["maximum"] is not None and value > check["maximum"]) for value in values)
        if not target_set:
            state = "target_not_set"
            self.ask("checks." + check["id"] + ".target", "What minimum and/or maximum target applies to " + str(check["name"]) + "?")
        elif outside:
            state = "out_of_range"
        elif review:
            state = "needs_review"
            self.ask("configurations." + configuration["id"] + ".checks." + check["id"], "Confirm matching material/process/geometry/method conditions and enter readings before using this check.")
        elif not values:
            state = "missing_records"
            self.ask("configurations." + configuration["id"] + ".checks." + check["id"], "Enter a " + str(kind) + " record for the current configuration and this check, with matching conditions confirmed.")
        else:
            state = "entered_readings_in_range"
        public_records = [{key: value for key, value in record.items() if key != "valid" and key != "readings"} | {"readings": [{key: value for key, value in reading.items() if key != "number"} for reading in record["readings"]]} for record in candidates]
        return {"check_id": check["id"], "name": check["name"], "unit": check["unit"], "method": check["method"], "required": check["required"], "target": {"minimum": _decimal_text(check["minimum"]), "maximum": _decimal_text(check["maximum"])}, "state": state, "record_count": len(usable), "reading_count": len(values), "entered_record_count": len(candidates), "unconfirmed_record_count": sum(record["conditions_confirmed"] is not True for record in candidates), "minimum_entered": _decimal_text(min(values)) if values else None, "maximum_entered": _decimal_text(max(values)) if values else None, "source_kind": kind, "needs_review": review, "records": public_records}

    def run(self):
        case_id = self.text(self.request.get("case_id"), "case_id")
        kind = self.request.get("assessment_kind")
        if kind not in _KINDS:
            self.error("assessment_kind", "assessment_kind_required", "Assess exactly one explicit synthetic or user_reported source kind.")
        self.configurations()
        self.check_specs()
        self.record_entries(case_id, kind)
        configurations = []
        for identifier, revision in self.current.items():
            config = self.configs[(identifier, revision)]
            checks = [self.assess_check(config, check, kind) for check in self.checks.values()]
            required = [check for check in checks if check["required"]]
            blockers = sorted({check["state"] for check in required if check["state"] != "entered_readings_in_range"})
            if self.errors:
                state = "needs_review"
            elif not required:
                state = "no_required_checks"
                self.ask("checks.required", "Which property checks are required for this product? No required checks cannot establish an all-check result.")
            elif "out_of_range" in blockers:
                state = "out_of_range"
            elif "needs_review" in blockers:
                state = "needs_review"
            elif "target_not_set" in blockers:
                state = "target_not_set"
            elif "missing_records" in blockers:
                state = "missing_records"
            else:
                state = "all_entered_checks_in_range"
            configurations.append({**config, "current_revision": revision, "is_current": True, "state": state, "blocking_states": blockers, "checks": checks, "performance_verified": False, "physical_product_tested": False})
        versions = [{**config, "current_revision": self.current[config["id"]], "is_current": config["revision"] == self.current[config["id"]]} for config in self.configs.values()]
        return {"status": "needs_clarification" if self.errors else "valid", "case_id": case_id, "assessment_kind": kind, "configurations": configurations, "configuration_versions": versions, "ignored_records": self.ignored, "errors": self.errors, "questions": self.questions, "warnings": ["This assessment describes entered readings only; no interpolation, causal effect, future-batch consistency or finished-product qualification is established."], "performance_verified": False, "physical_product_tested": False, "quantity_preparation_supported": False}


def assess_trial_records(request):
    """Assess one evidence kind at current exact configuration versions.

    See docs/TRIAL_RECORDS.md. Unknown component context is retained, not completed
    into a formulation. Numeric extrema describe entered readings, never batches.
    """
    return _Assessment(request).run()
