from copy import deepcopy
from decimal import Decimal as D
from itertools import product
import random
import unittest

from rematter.balance import plan_balance, plan_shared_balance, balance_layout_svg
from rematter.products import ProductInputError


def fixture():
    return {"case_label": "Synthetic two-target fixture", "coordinate_basis": "Common x datum; actual trim mass-centre locations are supplied, not inferred hole centres",
            "command_resolution_kg": .001,
            "total_max_add_kg": .15, "total_max_remove_kg": .08,
            "observation": {"id": "balance-1", "kind": "simulated", "mass_kg": .95, "mass_uncertainty_kg": .005, "cg_x_mm": 10, "cg_uncertainty_mm": .5},
            "targets": {"mass_min_kg": .98, "mass_max_kg": 1.02, "cg_min_mm": -2, "cg_max_mm": 2},
            "positions": [{"id": name, "x_mm": x, "position_uncertainty_mm": 0, "max_add_kg": .15, "max_remove_kg": .08, "adjustment_uncertainty_kg": .001} for name, x in (("left", -60), ("right", 60))],
            "baseline": {"position_id": "left", "command_kg": .05}}


def independent_corners(case, commands):
    observation, positions = case["observation"], case["positions"]
    rows = []
    for signs in product((-1, 1), repeat=6):
        mass = D(str(observation["mass_kg"])) + signs[0] * D(str(observation["mass_uncertainty_kg"]))
        cg = D(str(observation["cg_x_mm"])) + signs[1] * D(str(observation["cg_uncertainty_mm"]))
        deltas = [D(str(command)) + (signs[2 + i] * D(str(positions[i]["adjustment_uncertainty_kg"])) if command else 0) for i, command in enumerate(commands)]
        coordinates = [D(str(p["x_mm"])) + signs[4 + i] * D(str(p["position_uncertainty_mm"])) for i, p in enumerate(positions)]
        after_mass = mass + sum(deltas)
        after_cg = (mass * cg + sum(delta * coordinate for delta, coordinate in zip(deltas, coordinates))) / after_mass
        rows.append((after_mass, after_cg, deltas))
    return rows


def bound_fixture():
    case = fixture()
    return {"brief": {"input": "Synthetic contained recycled mass", "variation": "Observation-specific; no future batches predicted", "contamination": "Unknown, not modeled",
                      "product": "Synthetic ballast module", "use_case": "Static software example", "targets": "Mass 0.98–1.02 kg; balance x=-2…2 mm", "process": "No physical processing", "available_changes": "Add/remove known sealed trim units at the entered mass-centre locations"},
            "calculation_context": {"label": case["case_label"], "components": [{"id": 1, "name": "", "role": "main", "amount": ""}], "amount_unit": "g", "amount_basis": "",
                                    "mass_target_min_kg": ".98", "mass_target_max_kg": "1.02", "balance": {"coordinate_basis": case["coordinate_basis"], "target_min_mm": "-2", "target_max_mm": "2"}},
            "feedback": {"observation": {"id": "balance-1", "kind": "simulated", "mass_kg": .95, "uncertainty_kg": .005}, "max_add_mass_kg": .15, "max_remove_mass_kg": .08, "adjustment_uncertainty_kg": .001},
            "balance": {"cg_x_mm": 10, "cg_uncertainty_mm": .5, "command_resolution_kg": .001, "independent_adjustments": True,
                        "positions": [{key: value for key, value in p.items() if key != "adjustment_uncertainty_kg"} for p in case["positions"]], "baseline": case["baseline"]}}


class BalanceTests(unittest.TestCase):
    def test_exact_location_survives_the_actionable_diagram_label(self):
        case = fixture()
        coordinate = .123456789
        case['observation'].update(mass_kg=1, mass_uncertainty_kg=0, cg_x_mm=coordinate, cg_uncertainty_mm=0)
        case['targets'].update(mass_min_kg=1.1, mass_max_kg=1.1, cg_min_mm=coordinate, cg_max_mm=coordinate)
        case['positions'][0]['x_mm'] = coordinate
        for p in case['positions']: p['adjustment_uncertainty_kg'] = 0
        result = plan_balance(case)
        self.assert_checked(case, result)
        self.assertIn('left · x=0.123456789 mm', balance_layout_svg(result))

    def test_exported_command_keeps_the_precision_that_the_model_checked(self):
        for starting_mass, increment, grams in ((.8958333, .0000001, '104.1667'), (1, .0000001, '0.0004')):
            case = fixture()
            target_mass = 1 if starting_mass != 1 else 1.0000004
            case['observation'].update(mass_kg=starting_mass, mass_uncertainty_kg=0, cg_x_mm=0, cg_uncertainty_mm=0)
            case['targets'].update(mass_min_kg=target_mass, mass_max_kg=target_mass, cg_min_mm=0, cg_max_mm=0)
            case['command_resolution_kg'] = increment
            case['baseline']['command_kg'] = 0
            for p, x in zip(case['positions'], (0, 100)):
                p.update(x_mm=x, adjustment_uncertainty_kg=0)
            result = plan_balance(case)
            self.assertTrue(result['feasible'])
            self.assert_checked(case, result)
            self.assertIn('ADD ' + grams + ' g', balance_layout_svg(result))

    def test_keeps_a_single_location_baseline_when_both_targets_already_fit(self):
        case = fixture()
        case["targets"].update(cg_min_mm=5, cg_max_mm=8)
        result = plan_balance(case)
        self.assertEqual(result["selection"], "entered_baseline")
        self.assertEqual([p["command_kg"] for p in result["commands"]], [.05, 0])
        self.assert_checked(case, result)

    def assert_checked(self, case, result):
        commands = [row["command_kg"] for row in result["commands"]]
        targets = case["targets"]
        corners = independent_corners(case, commands)
        for mass, cg, deltas in corners:
            self.assertLessEqual(D(str(targets["mass_min_kg"])), mass)
            self.assertLessEqual(mass, D(str(targets["mass_max_kg"])))
            self.assertLessEqual(D(str(targets["cg_min_mm"])), cg)
            self.assertLessEqual(cg, D(str(targets["cg_max_mm"])))
            for p, delta in zip(case["positions"], deltas):
                self.assertLessEqual(-D(str(p["max_remove_kg"])), delta)
                self.assertLessEqual(delta, D(str(p["max_add_kg"])))
            self.assertLessEqual(sum(max(D(0), d) for d in deltas), D(str(case["total_max_add_kg"])))
            self.assertLessEqual(sum(max(D(0), -d) for d in deltas), D(str(case["total_max_remove_kg"])))
        for name, expected in (("mass_min_kg", min(r[0] for r in corners)), ("mass_max_kg", max(r[0] for r in corners)),
                               ("cg_min_mm", min(r[1] for r in corners)), ("cg_max_mm", max(r[1] for r in corners))):
            self.assertAlmostEqual(result["result"][name], float(expected), places=10)

    def test_mass_only_can_pass_mass_and_fail_balance_then_two_positions_fit(self):
        case = fixture(); result = plan_balance(case)
        self.assertTrue(result["baseline"]["mass_inside_target"])
        self.assertFalse(result["baseline"]["balance_inside_target"])
        self.assertGreater(result["baseline"]["cg_min_mm"], 5)
        self.assertEqual([p["command_kg"] for p in result["commands"]], [.104, -.054])
        self.assert_checked(case, result)
        self.assertFalse(result["physical_product_tested"])

    def test_existing_fit_uses_no_operation_without_adjustment_error(self):
        case = fixture(); case["observation"].update(mass_kg=1, cg_x_mm=0)
        result = plan_balance(case)
        self.assertEqual([p["command_kg"] for p in result["commands"]], [0, 0])
        self.assertAlmostEqual(result["result"]["mass_min_kg"], .995)
        self.assert_checked(case, result)

    def test_insufficient_adjustment_stock_is_infeasible(self):
        case = fixture()
        for p in case["positions"]: p.update(max_add_kg=.01, max_remove_kg=.01)
        result = plan_balance(case)
        self.assertEqual(result["status"], "infeasible")
        self.assertIsNone(result["commands"])

    def test_exact_solution_can_be_unrepresentable_at_entered_increment(self):
        case = fixture(); case["observation"].update(mass_uncertainty_kg=0, cg_uncertainty_mm=0)
        case["targets"].update(mass_min_kg=1, mass_max_kg=1, cg_min_mm=0, cg_max_mm=0)
        for p in case["positions"]: p["adjustment_uncertainty_kg"] = 0
        result = plan_balance(case)
        self.assertTrue(result["exact_model_feasible"])
        self.assertEqual(result["status"], "precision_limited")
        self.assertIsNone(result["commands"])

    def test_missing_spatial_measurement_and_invalid_numbers_do_not_get_defaults(self):
        for field in ("cg_x_mm", "cg_uncertainty_mm"):
            case = fixture(); del case["observation"][field]
            with self.assertRaises(ProductInputError): plan_balance(case)
        for value in (True, float("inf"), float("nan"), -1):
            case = fixture(); case["observation"]["mass_uncertainty_kg"] = value
            with self.assertRaises(ProductInputError): plan_balance(case)

    def test_invalid_position_identity_stock_and_coordinate_basis_fail(self):
        cases = []
        case = fixture(); case["positions"][1]["id"] = "left"; cases.append(case)
        case = fixture(); case["coordinate_basis"] = ""; cases.append(case)
        case = fixture(); case["positions"][0]["max_remove_kg"] = 1; cases.append(case)
        case = fixture(); case["command_resolution_kg"] = 0; cases.append(case)
        for case in cases:
            with self.assertRaises(ProductInputError): plan_balance(case)

    def test_same_position_cannot_resolve_this_two_target_problem(self):
        case = fixture(); case["positions"][1]["x_mm"] = -60
        self.assertEqual(plan_balance(case)["status"], "infeasible")

    def test_returned_commands_cover_independent_corners_across_varied_inputs(self):
        rng = random.Random(1126); feasible = 0
        for _ in range(24):
            case = fixture(); case["observation"].update(mass_kg=round(rng.uniform(.88,1.08),3), cg_x_mm=round(rng.uniform(-15,15),2))
            case.update(total_max_add_kg=.3, total_max_remove_kg=.2)
            for p in case["positions"]: p.update(max_add_kg=.3, max_remove_kg=.2, position_uncertainty_mm=.2)
            result = plan_balance(case)
            if result["feasible"]:
                feasible += 1; self.assert_checked(case, result)
        self.assertGreater(feasible, 15)

    def test_changed_observation_or_targets_change_fingerprint(self):
        case = fixture(); initial = plan_balance(case)["request_fingerprint"]
        for section, field, value in (("observation", "cg_x_mm", 11), ("targets", "cg_max_mm", 3)):
            changed = deepcopy(case); changed[section][field] = value
            self.assertNotEqual(initial, plan_balance(changed)["request_fingerprint"])

    def test_shared_case_binds_mass_targets_and_observation_and_exports_safe_diagram(self):
        request = bound_fixture(); original = deepcopy(request)
        result = plan_shared_balance(request)
        self.assertEqual(request, original)
        self.assertEqual(result["request"]["observation"]["id"], "balance-1")
        self.assertEqual(result["request"]["targets"]["mass_min_kg"], .98)
        self.assertIn("SIMULATION", result["layout_svg"])
        self.assertIn("ADD 104 g", result["layout_svg"])
        self.assertTrue(result["feasible"])
        request["request_fingerprint"] = result["request_fingerprint"]
        self.assertEqual(plan_shared_balance(request)["request_fingerprint"], result["request_fingerprint"])
        request["feedback"]["observation"]["mass_kg"] = .96
        with self.assertRaises(ProductInputError): plan_shared_balance(request)

    def test_diagram_escapes_supplied_text(self):
        request = bound_fixture(); request["calculation_context"]["label"] = '<script>alert("x")</script>'
        svg = plan_shared_balance(request)["layout_svg"]
        self.assertNotIn("<script>", svg)
        self.assertIn("&lt;script&gt;", svg)

    def test_shared_balance_requires_exact_targets_and_independent_bounds(self):
        for mutate in (
            lambda r: r["calculation_context"].pop("balance"),
            lambda r: r["calculation_context"]["balance"].update(target_min_mm=""),
            lambda r: r["balance"].update(independent_adjustments=False),
            lambda r: r["balance"].update(mass_min_kg=.5),
        ):
            request = bound_fixture(); mutate(request)
            with self.assertRaises(ProductInputError): plan_shared_balance(request)


class BalanceToolTests(unittest.TestCase):
    def run_script(self, request, responses):
        from test_engineering_agent import ScriptedTransport
        from rematter.meta import MetaClient
        from rematter.engineering_agent import assist_with_adaptation
        transport = ScriptedTransport(responses)
        client = MetaClient(environ={"MODEL_API_KEY": "fixture-private-key", "META_MODEL": "muse-spark-1.3"}, opener=transport)
        return assist_with_adaptation(request, client=client), transport

    def request(self):
        return {**bound_fixture(), "plan": None, "question": "Keep both mass and balance within the stated targets. What should change?"}

    def test_real_tool_transport_executes_combined_check_and_returns_actual_diagram(self):
        from test_engineering_agent import reply, call, present
        result, transport = self.run_script(self.request(), [reply(call("joint", "check_mass_and_balance")), reply(present("final", "joint", "adjust_balance", "Add the checked amount at the left mass centre and remove the checked amount at the right."))])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["decision"]["action"], "adjust_balance")
        self.assertEqual(len(result["tool_trace"]), 1)
        self.assertIn("layout_svg", result["tool_trace"][0]["result"])
        self.assertEqual(result["verified_summary"]["commands"][0]["command_kg"], .104)
        self.assertEqual(len(transport.requests), 2)

    def test_mass_only_result_cannot_complete_the_joint_target_request(self):
        from test_engineering_agent import reply, call, present
        result, _ = self.run_script(self.request(), [reply(call("mass", "check_mass_feedback")), reply(present("wrong", "mass", "add_mass")),
            reply(call("joint", "check_mass_and_balance")), reply(present("right", "joint", "adjust_balance"))])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["decision"]["basis_call_id"], "joint")
        rejected = result["model_trace"][1]["tool_results"][0]["result"]
        self.assertEqual(rejected["status"], "rejected")
        self.assertIn("both mass and balance", rejected["reason"])
