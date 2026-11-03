"""Exact, user-entered batch manufacturing costs; no property predictions."""

from decimal import Decimal, localcontext
from fractions import Fraction
import re


_DECIMAL = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$")
_MASS = {"kg": Fraction(1), "g": Fraction(1, 1000), "t": Fraction(1000),
         "lb": Fraction("0.45359237"), "oz": Fraction("0.45359237") / 16}
_CATEGORIES = ("materials", "energy", "labor", "other")


def _display(value):
    if value is None:
        return None
    with localcontext() as context:
        context.prec = 40
        result = format(Decimal(value.numerator) / Decimal(value.denominator), "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


class _Calculation:
    def __init__(self, request):
        self.request = request if isinstance(request, dict) else {}
        self.errors = []
        self.questions = []
        self.warnings = []
        self.exact = {}
        self.cost_values = []
        self.cost_missing = False
        self.category_statuses = {}
        if not isinstance(request, dict):
            self.error("request", "object_required", "Enter one cost-record object.")

    def error(self, field, code, message, category="cost"):
        self.errors.append({"field": field, "code": code, "message": message, "category": category})

    def ask(self, field, question, category="cost"):
        if not any(item["field"] == field for item in self.questions):
            self.questions.append({"field": field, "question": question, "category": category})
        if category == "cost":
            self.cost_missing = True

    def number(self, value, field, *, integer=False, category="cost"):
        if value is None or value == "":
            self.ask(field, "What is the entered value, or is it still unknown?", category)
            return None
        if not isinstance(value, str) or len(value) > 100 or not _DECIMAL.fullmatch(value):
            self.error(field, "decimal_string_required", "Use a finite decimal string without an exponent.", category)
            return None
        result = Fraction(value)
        if result < 0:
            self.error(field, "negative_not_supported", "Negative values/credits require a separate accounting scope.", category)
            return None
        if integer and result.denominator != 1:
            self.error(field, "whole_count_required", "Observed and gross product counts must be whole numbers.", category)
            return None
        return result

    def save(self, field, value):
        if value is not None:
            self.exact[field] = {"numerator": str(value.numerator), "denominator": str(value.denominator)}
        return _display(value)

    def currency(self, item, field):
        currency = item.get("currency", self.request.get("currency"))
        if currency and self.request.get("currency") and currency != self.request["currency"]:
            self.error(field, "currency_mismatch", "Currencies cannot be combined without an explicit separate conversion model.")

    def mass(self, quantity, unit, field):
        value = self.number(quantity, field)
        if unit is None or unit == "":
            self.ask(field + "_unit", "Which mass unit applies: kg, g, t, lb or oz?")
            return None
        if not isinstance(unit, str) or unit not in _MASS:
            self.error(field + "_unit", "mass_unit_required", "Choose kg, g, t, lb or oz; volume is not a mass conversion.")
            return None
        return None if value is None else value * _MASS[unit]

    def text(self, value, field, category="cost"):
        if value is None or value == "":
            return None
        if not isinstance(value, str) or not value.strip():
            self.error(field, "text_required", "Use a nonempty text label.", category)
            return None
        return value

    def status(self, category, item, default="unknown"):
        state = item.get("status", default)
        if state not in ("known", "unknown", "excluded"):
            self.error(category + ".status", "invalid_status", "Choose known, unknown or excluded.")
            state = "unknown"
        self.category_statuses[category] = state
        if state == "unknown":
            self.ask(category, "What batch " + category + " costs are known, or are they explicitly outside this cost scope?")
        return state

    def materials(self):
        rows = self.request.get("materials", [])
        if not isinstance(rows, list):
            self.error("materials", "list_required", "Enter material cost lines as a list.")
            rows = []
        state = self.status("materials", {"status": self.request.get("material_status", "known" if rows else "unknown")})
        if state != "known":
            if rows:
                self.error("materials", "scope_conflict", "Material lines conflict with their unknown/excluded status.")
            return None, []
        if not rows:
            self.ask("materials", "Which named stocks and charged quantities/prices belong to this batch?")
            return None, []
        if any(not isinstance(row, dict) for row in rows):
            self.error("materials", "object_required", "Each material line must be an object.")
            return None, []
        percent = [row.get("quantity_unit") == "mass_percent" for row in rows]
        if any(percent) and not all(percent):
            self.error("materials", "mixed_recipe_basis", "Use either charged masses or one complete mass-percent recipe.")
        batch = self.request.get("batch_mass", {})
        batch = batch if isinstance(batch, dict) else {}
        batch_mass = self.mass(batch.get("quantity"), batch.get("unit"), "batch_mass.quantity") if all(percent) else None
        percentages = []
        total = Fraction(0)
        known = False
        result = []
        seen = set()
        for index, row in enumerate(rows):
            field = "materials." + str(index)
            name = self.text(row.get("name"), field + ".name")
            if not name:
                self.ask(field + ".name", "What named stock does this cost line describe?")
            line_id = row.get("id")
            if line_id is not None:
                line_id = self.text(line_id, field + ".id")
            if line_id and line_id in seen:
                self.error(field + ".id", "duplicate_cost_line", "The same charged material line cannot be counted twice.")
            if line_id:
                seen.add(line_id)
            self.currency(row, field + ".currency")
            basis = self.text(row.get("quantity_basis", self.request.get("mass_basis")), field + ".quantity_basis")
            price_basis = self.text(row.get("price_basis", self.request.get("mass_basis")), field + ".price_basis")
            if not basis or not price_basis:
                self.ask(field + ".basis", "Are the charged quantity and price on the same dry/as-received mass basis?")
            elif basis != price_basis:
                self.error(field + ".basis", "mass_basis_mismatch", "Quantity and price need the same mass basis; no moisture conversion is assumed.")
            if all(percent) and basis and batch.get("basis") != basis:
                if not batch.get("basis"):
                    self.ask("batch_mass.basis", "What dry/as-received basis applies to the total batch mass?")
                else:
                    self.error("batch_mass.basis", "mass_basis_mismatch", "The total batch mass and percentage recipe need the same explicit basis.")
            if percent[index]:
                fraction = self.number(row.get("quantity"), field + ".quantity")
                if fraction is not None:
                    percentages.append(fraction)
                quantity = None if fraction is None or batch_mass is None else batch_mass * fraction / 100
            elif row.get("quantity_unit") == "volume_percent":
                quantity = None
                self.ask(field + ".charged_mass", "What independently entered charged mass does this stock have in kg, g, t, lb or oz? Volume percentages do not establish mass.")
            else:
                quantity = self.mass(row.get("quantity"), row.get("quantity_unit"), field + ".quantity")
            rate = self.number(row.get("unit_price"), field + ".unit_price")
            price_unit = row.get("price_unit")
            if price_unit is None or price_unit == "":
                self.ask(field + ".price_unit", "Is the entered price per kg, g, t, lb or oz?")
            elif not isinstance(price_unit, str) or price_unit not in _MASS:
                self.error(field + ".price_unit", "mass_unit_required", "Price denominator must be kg, g, t, lb or oz.")
            value = None
            if quantity is not None and rate is not None and isinstance(price_unit, str) and price_unit in _MASS and basis and price_basis and basis == price_basis:
                value = quantity * rate / _MASS[price_unit]
                total += value
                known = True
            result.append({"id": line_id, "name": name, "currency": row.get("currency", self.request.get("currency")), "charged_mass_kg": self.save(field + ".charged_mass_kg", quantity), "known_cost": self.save(field + ".known_cost", value)})
        if all(percent) and len(percentages) == len(rows) and sum(percentages) != 100:
            self.error("materials", "recipe_not_complete", "Mass percentages must sum exactly to 100; they are not normalized.")
        return total if known else None, result

    def check_includes(self, item, field, process):
        includes = item.get("includes")
        if not includes:
            return
        if not isinstance(includes, list) or any(value not in ("energy", "labor", "materials") for value in includes):
            self.error(field, "overlap_unresolved", "Identify the included energy, labor or material categories explicitly.")
            return
        for included in includes:
            state = self.request.get("material_status", "known" if self.request.get("materials") else "unknown") if included == "materials" else process.get(included, {}).get("status", "unknown") if isinstance(process.get(included, {}), dict) else "unknown"
            if state != "excluded":
                self.error(field, "overlap_unresolved", "An inclusive charge requires its separately entered categories to be explicitly excluded.")

    def process_cost(self, category, process):
        item = process.get(category, {})
        if not isinstance(item, dict):
            self.error("process." + category, "object_required", "Enter a process-cost object.")
            item = {}
        state = self.status(category, item)
        if state != "known":
            if any(key in item for key in ("kwh", "person_hours", "rate", "charges")):
                self.error("process." + category, "scope_conflict", "Cost entries conflict with their unknown/excluded status.")
            return None
        self.check_includes(item, "process." + category + ".includes", process)
        self.currency(item, "process." + category + ".currency")
        if category != "other":
            key = "kwh" if category == "energy" else "person_hours"
            amount = self.number(item.get(key), "process." + category + "." + key)
            rate = self.number(item.get("rate"), "process." + category + ".rate")
            return None if amount is None or rate is None else amount * rate
        charges = item.get("charges")
        if not isinstance(charges, list):
            self.ask("process.other.charges", "Which nonoverlapping batch charges apply? An explicit empty list means zero.")
            return None
        total = Fraction(0)
        known = not charges
        seen = set()
        for index, charge in enumerate(charges):
            field = "process.other.charges." + str(index)
            if not isinstance(charge, dict):
                self.error(field, "object_required", "Each batch charge must be an object.")
                continue
            if not self.text(charge.get("name"), field + ".name"):
                self.ask(field + ".name", "What manufacturing batch charge is this?")
            self.currency(charge, field + ".currency")
            self.check_includes(charge, field + ".includes", process)
            charge_id = charge.get("id")
            if charge_id is not None:
                charge_id = self.text(charge_id, field + ".id")
            if charge_id and charge_id in seen:
                self.error(field + ".id", "duplicate_cost_line", "This batch charge is already included.")
            if charge_id:
                seen.add(charge_id)
            value = self.number(charge.get("amount"), field + ".amount")
            if value is not None:
                total += value
                known = True
        return total if known else None

    def output(self):
        item = self.request.get("output", {})
        if not isinstance(item, dict):
            self.error("output", "object_required", "Enter an output record.", "output")
            item = {}
        mode = item.get("mode")
        if mode not in ("actual", "planned"):
            self.ask("output.mode", "Is usable output observed or a planning estimate?", "output")
        acceptance = self.text(item.get("acceptance_basis"), "output.acceptance_basis", "output")
        if not acceptance:
            self.ask("output.acceptance_basis", "What does usable mean for this batch? Cost does not qualify physical performance.", "output")
        values = {}
        if mode == "actual" and "accepted_fraction" in item:
            self.error("output", "output_mode_conflict", "Use actual usable output directly or planned gross output times acceptance, not both.", "output")
        fraction = None
        if mode == "planned":
            if any(key in item for key in ("usable_count", "usable_mass_kg", "usable_area_m2")):
                self.error("output", "output_mode_conflict", "Planned mode derives usable output from gross output and accepted fraction.", "output")
            fraction = self.number(item.get("accepted_fraction"), "output.accepted_fraction", category="output")
            if fraction is not None and fraction > 1:
                self.error("output.accepted_fraction", "invalid_fraction", "Acceptance fraction must be between zero and one.", "output")
        for suffix in ("count", "mass_kg", "area_m2"):
            usable_key, gross_key = "usable_" + suffix, "gross_" + suffix
            value = None
            if mode == "actual" and usable_key in item:
                value = self.number(item.get(usable_key), "output." + usable_key, integer=suffix == "count", category="output")
            if gross_key in item:
                gross = self.number(item.get(gross_key), "output." + gross_key, integer=suffix == "count", category="output")
                if mode == "planned" and gross is not None and fraction is not None:
                    value = gross * fraction
                elif value is not None and gross is not None:
                    if value > gross:
                        self.error("output." + usable_key, "usable_exceeds_gross", "Usable output exceeds gross output on the same stated boundary.", "output")
                    if gross > 0:
                        values["acceptance_fraction_" + suffix] = value / gross
            values[usable_key] = value
        if not any(values.get("usable_" + suffix) is not None for suffix in ("count", "mass_kg", "area_m2")):
            self.ask("output.usable", "How many usable units, kg or explicitly measured m² does this batch provide?", "output")
        return mode, acceptance, values

    def run(self):
        request = self.request
        if not isinstance(request.get("currency"), str) or not request.get("currency", "").strip():
            self.ask("currency", "Which single currency applies to this cost record?")
        for key in ("case_id", "configuration_id", "configuration_revision", "current_configuration_revision", "product_basis", "functional_basis", "scope_basis"):
            if request.get(key) is None or request.get(key) == "":
                self.ask(key, "What is this record's " + key.replace("_", " ") + "?", "metadata")
            elif key not in ("configuration_revision", "current_configuration_revision"):
                self.text(request[key], key, "metadata")
            elif isinstance(request[key], bool) or not isinstance(request[key], (str, int)):
                self.error(key, "revision_required", "Use an explicit text or integer revision.", "metadata")
            elif isinstance(request[key], str):
                self.text(request[key], key, "metadata")
        material, lines = self.materials()
        process = request.get("process", {})
        if not isinstance(process, dict):
            self.error("process", "object_required", "Enter process cost categories as an object.")
            process = {}
        costs = {"materials": material}
        for category in ("energy", "labor", "other"):
            costs[category] = self.process_cost(category, process)
        mode, acceptance, outputs = self.output()
        cost_errors = any(error["category"] == "cost" for error in self.errors)
        output_errors = any(error["category"] == "output" for error in self.errors)
        known = [value for value in costs.values() if value is not None]
        currency_known = isinstance(request.get("currency"), str) and bool(request["currency"].strip())
        subtotal = sum(known, Fraction(0)) if known and not cost_errors and currency_known else None
        complete = subtotal is not None and not self.cost_missing and not cost_errors
        if all(state == "excluded" for state in self.category_statuses.values()):
            self.ask("scope", "Which manufacturing costs are included? An empty scope has no cost result.")
            complete = False
        total = subtotal if complete else None
        usable_cost = total if complete else subtotal
        units = {}
        for suffix, key in (("count", "per_usable_unit"), ("mass_kg", "per_usable_kg"), ("area_m2", "per_usable_m2")):
            denominator = outputs.get("usable_" + suffix)
            value = None
            if not output_errors and acceptance and mode in ("actual", "planned") and denominator is not None and denominator > 0 and usable_cost is not None:
                value = usable_cost / denominator
            units[key] = self.save("unit_costs." + key, value)
            if denominator == 0:
                self.warnings.append("Zero usable " + suffix + ": its unit cost is undefined.")
        revision = request.get("configuration_revision")
        current = request.get("current_configuration_revision")
        is_current = None if revision in (None, "") or current in (None, "") else str(revision) == str(current)
        if is_current is False:
            self.warnings.append("Historical configuration revision: this cost is not current.")
        excluded = [category for category, state in self.category_statuses.items() if state == "excluded"]
        if excluded:
            self.warnings.append("Explicitly excluded cost categories: " + ", ".join(excluded) + ".")
        if mode == "planned":
            self.warnings.append("Usable output and unit costs are planning equivalents, not observed products.")
        status = "needs_clarification" if self.errors else "complete" if complete else "partial"
        return {
            "status": status,
            **{key: request.get(key) for key in ("case_id", "configuration_id", "configuration_revision", "current_configuration_revision", "currency", "product_basis", "functional_basis", "scope_basis")},
            "is_current": is_current,
            "category_statuses": self.category_statuses,
            "materials": lines,
            "costs": {**{key: self.save("costs." + key, None if cost_errors else value) for key, value in costs.items()}, "known_subtotal": self.save("costs.known_subtotal", subtotal), "entered_scope_total": self.save("costs.entered_scope_total", total)},
            "output": {"mode": mode, "acceptance_basis": acceptance, **{key: self.save("output." + key, value) for key, value in outputs.items()}},
            "unit_costs": units,
            "unit_costs_scope": "entered_scope_total" if complete else "known_subtotal",
            "physical_target_status": "not_assessed",
            "exact_values": self.exact,
            "questions": self.questions,
            "errors": self.errors,
            "warnings": self.warnings,
        }


def calculate_manufacturing_cost(request):
    """Return scoped batch/unit costs, exact rationals and missing-input questions.

    Numeric user inputs must be decimal strings. Unknown costs remain partial;
    invalid/overlapping cost inputs never produce an aggregate. See the contract
    in docs/MANUFACTURING_COST.md. This function does not assess physical targets.
    """
    return _Calculation(request).run()


def compare_manufacturing_costs(requests):
    """Compare only complete, current records on a common declared cost/output scope."""
    if not isinstance(requests, list) or len(requests) < 2:
        return {"results": [], "comparable": False, "reasons": ["Provide at least two cost-record objects."], "winners": {}}
    results = [calculate_manufacturing_cost(request) for request in requests]
    reasons = []
    if any(result["status"] != "complete" for result in results):
        reasons.append("All records need complete, conflict-free costs within their entered scope.")
    if any(result["is_current"] is not True for result in results):
        reasons.append("All configuration revisions must be explicitly current.")
    if any(not result["configuration_id"] for result in results):
        reasons.append("Every compared record needs an explicit configuration identity.")
    identities = [result["configuration_id"] for result in results]
    if all(isinstance(value, str) for value in identities) and len(set(identities)) != len(identities):
        reasons.append("Compared configuration identities must be distinct.")
    for field in ("case_id", "currency", "product_basis", "functional_basis", "scope_basis"):
        if not results[0].get(field) or any(result.get(field) != results[0].get(field) for result in results):
            reasons.append("Records need the same explicit " + field + ".")
    if any(result["category_statuses"] != results[0]["category_statuses"] for result in results):
        reasons.append("Included/excluded manufacturing categories must match.")
    acceptance = results[0]["output"]["acceptance_basis"]
    if not acceptance or any(result["output"]["acceptance_basis"] != acceptance for result in results):
        reasons.append("Usable-output acceptance definitions must match.")
    if any(result["output"]["mode"] != results[0]["output"]["mode"] for result in results):
        reasons.append("Do not name a winner between observed output and planned output estimates.")
    winners = {}
    for metric in ("per_usable_unit", "per_usable_kg", "per_usable_m2"):
        field = "unit_costs." + metric
        if reasons or any(field not in result["exact_values"] for result in results):
            winners[metric] = None
            continue
        values = [Fraction(int(result["exact_values"][field]["numerator"]), int(result["exact_values"][field]["denominator"])) for result in results]
        minimum = min(values)
        winners[metric] = {"configuration_ids": [result["configuration_id"] for result, value in zip(results, values) if value == minimum], "tie": values.count(minimum) > 1, "cost": _display(minimum)}
    if not reasons and all(value is None for value in winners.values()):
        reasons.append("No common positive, explicitly entered usable-output denominator is available.")
    return {"results": results, "comparable": not reasons, "reasons": reasons, "winners": winners, "physical_target_status": "not_assessed", "attribution": "Complete configurations may co-vary; cost differences do not identify a causal material/process effect."}
