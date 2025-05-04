class MegaBuilder:
    """A contrived class with deeply nested logic to serve as a fixture for diff tests."""

    DEFAULTS = {
        "opt_level": 2,
        "targets": ["x86", "arm"],
        "features": {"simd": True, "opencl": False},
    }

    def __init__(self, config=None):
        self.config = self.DEFAULTS.copy()
        if config:
            self._merge_config(config)

    # ────────────────────────────── public API ──────────────────────────────
    def build_all(self, artifacts_dir):
        for arch in self.config["targets"]:
            self._log(f"▶ building for {arch}")
            result = self._build_single(arch, artifacts_dir)
            if result:  # only package successful outputs
                self._package(result, artifacts_dir)

    # ───────────────────────────── internal helpers ─────────────────────────
    def _merge_config(self, other):
        for k, v in other.items():
            if isinstance(v, dict) and isinstance(self.config.get(k), dict):
                for sub_k, sub_v in v.items():
                    self.config[k][sub_k] = sub_v
            else:
                self.config[k] = v

    def _build_single(self, arch, out_dir):
        self._log(f"  • configuring ({arch})")
        cfg = self._make_cfg(arch)
        try:
            self._log("    • compiling")
            for step in ["pre", "compile", "link"]:
                self._run_step(step, cfg)

            if self.config["opt_level"] > 1:
                self._log("    • optimizing")
                for pass_name in self._optimization_passes(arch):
                    self._apply_pass(pass_name, cfg)

            return self._artifact_path(arch, out_dir)
        except RuntimeError as err:
            self._log(f"    ✖️ build failed: {err}", level="error")
            return None

    def _make_cfg(self, arch):
        base = {"arch": arch}
        if arch == "x86":
            base["flags"] = ["-mavx2" if self.config["features"]["simd"] else "-msse2"]
        else:
            base["flags"] = ["-mfpu=neon"] if self.config["features"]["simd"] else []
        return base

    def _run_step(self, step, cfg):
        self._log(f"      – {step}")
        if step == "link" and "opencl" in cfg.get("flags", []):
            raise RuntimeError("OpenCL linking unsupported")

    def _optimization_passes(self, arch):
        passes = ["inline", "dce"]
        if arch == "arm" and self.config["opt_level"] > 2:
            passes.append("vectorize")
        return passes

    def _apply_pass(self, pass_name, cfg):
        self._log(f"      → pass: {pass_name}")
        # pretend work happens here
        if pass_name == "vectorize" and not self.config["features"]["simd"]:
            raise RuntimeError("SIMD required for vectorization")

    def _artifact_path(self, arch, out_dir):
        return f"{out_dir}/{arch}/libmega.a"

    # ────────────────────────────── utilities ──────────────────────────────
    def _log(self, msg, *, level="info"):
        levels = {"info": "ℹ", "error": "❌", "debug": "🐞"}
        print(f"{levels.get(level, '?')} {msg}")
