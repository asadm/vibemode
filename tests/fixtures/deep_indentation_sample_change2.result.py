import asyncio
import json
import datetime
import sys # Added for example usage stream setup

class MegaBuilder:
    """A contrived class with deeply nested logic to serve as a fixture for diff tests.
       Refactored for full asynchronous operation.
    """

    DEFAULTS = {
        "opt_level": 2,
        "targets": ["x86", "arm"],
        "features": {"simd": True, "opencl": False},
    }

    def __init__(self, log_writer: asyncio.StreamWriter, config=None):
        """Initialize with an asyncio stream for logging."""
        self.log_writer = log_writer
        self.config = self.DEFAULTS.copy()
        if config:
            self._merge_config(config)

    # ────────────────────────────── public API ──────────────────────────────
    async def build_all(self, artifacts_dir):
        """Builds all configured target architectures concurrently."""
        tasks = []
        for arch in self.config["targets"]:
            # Create a task for each architecture build
            task = asyncio.create_task(self._build_single(arch, artifacts_dir))
            tasks.append(task)

        await self._log("Starting concurrent builds", targets=self.config["targets"])
        # Wait for all build tasks to complete
        results = await asyncio.gather(*tasks, return_exceptions=True) # Capture exceptions too

        await self._log("Concurrent builds finished", count=len(results))

        # Process results (packaging successful builds)
        for arch, result in zip(self.config["targets"], results):
            if isinstance(result, Exception):
                await self._log(f"Build for {arch} failed during gather", level="error", error=str(result), arch=arch)
            elif result:  # Check if _build_single returned a path (success)
                await self._package(result, artifacts_dir, arch)
            # else: _build_single already logged its failure and returned None

    # ───────────────────────────── internal helpers ─────────────────────────
    def _merge_config(self, other):
        for k, v in other.items():
            if isinstance(v, dict) and isinstance(self.config.get(k), dict):
                for sub_k, sub_v in v.items():
                    self.config[k][sub_k] = sub_v
            else:
                self.config[k] = v

    async def _build_single(self, arch, out_dir):
        """Builds a single architecture asynchronously."""
        await self._log(f"Configuring build", arch=arch)
        cfg = self._make_cfg(arch) # _make_cfg is still synchronous
        try:
            await self._log("Compiling", arch=arch, config=cfg)
            compile_tasks = []
            for step in ["pre", "compile", "link"]:
                 # Run compilation steps potentially concurrently if they were independent I/O bounds ops
                 # Here, we run them sequentially as they likely depend on each other
                 await self._run_step(step, cfg)

            if self.config["opt_level"] > 1:
                await self._log("Optimizing", arch=arch, level=self.config["opt_level"])
                # Optimization passes could potentially run concurrently if independent
                # Here, run sequentially for simplicity/dependency
                passes = self._optimization_passes(arch) # _optimization_passes is sync
                for pass_name in passes:
                    await self._apply_pass(pass_name, cfg)

            artifact = self._artifact_path(arch, out_dir) # _artifact_path is sync
            await self._log("Build successful", arch=arch, artifact=artifact)
            return artifact
        except RuntimeError as err:
            await self._log(f"Build failed: {err}", level="error", arch=arch, error=str(err))
            return None

    def _make_cfg(self, arch):
        base = {"arch": arch}
        if arch == "x86":
            base["flags"] = ["-mavx2" if self.config["features"]["simd"] else "-msse2"]
        else:
            base["flags"] = ["-mfpu=neon"] if self.config["features"]["simd"] else []
        return base

    async def _run_step(self, step, cfg):
        """Runs a single build step asynchronously."""
        await self._log(f"Running step: {step}", arch=cfg.get("arch"), step=step)
        # Simulate async work for the step
        await asyncio.sleep(0.05) # Example: Replace with actual async I/O or subprocess call
        if step == "link" and "opencl" in cfg.get("flags", []):
            raise RuntimeError("OpenCL linking unsupported")
        await self._log(f"Finished step: {step}", arch=cfg.get("arch"), step=step)

    def _optimization_passes(self, arch):
        passes = ["inline", "dce"]
        if arch == "arm" and self.config["opt_level"] > 2:
            passes.append("vectorize")
        return passes

    async def _apply_pass(self, pass_name, cfg):
        """Applies an optimization pass asynchronously."""
        await self._log(f"Applying pass: {pass_name}", arch=cfg.get("arch"), pass_name=pass_name)
        # Simulate async work for the pass
        await asyncio.sleep(0.02) # Example: Replace with actual async operation
        if pass_name == "vectorize" and not self.config["features"]["simd"]:
            raise RuntimeError("SIMD required for vectorization")
        await self._log(f"Finished pass: {pass_name}", arch=cfg.get("arch"), pass_name=pass_name)

    def _artifact_path(self, arch, out_dir):
        return f"{out_dir}/{arch}/libmega.a"

    # ────────────────────────────── utilities ──────────────────────────────
    async def _log(self, msg, *, level="info", **extra_data):
        """Asynchronously logs a structured JSON record to the configured stream."""
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        log_record = {
            "timestamp": timestamp,
            "level": level,
            "message": msg,
            **extra_data, # Include any additional context
        }
        try:
            json_str = json.dumps(log_record) + "\n"
            self.log_writer.write(json_str.encode("utf-8"))
            await self.log_writer.drain() # Ensure the buffer is flushed
        except (TypeError, OverflowError, BrokenPipeError, ConnectionResetError) as e:
            # Handle potential errors during JSON serialization or writing to stream
            # Fallback to stderr to avoid losing the log message entirely
            # In a real app, consider more robust error handling/logging
            fallback_msg = f"LOGGING ERROR: {e} | Original: {log_record}\n"
            sys.stderr.write(fallback_msg)
        except Exception as e:
             # Catch unexpected logging errors
             fallback_msg = f"UNEXPECTED LOGGING ERROR: {e} | Original: {log_record}\n"
             sys.stderr.write(fallback_msg)

    async def _package(self, artifact_path, artifacts_dir, arch):
        """Packages a successful build artifact."""
        # Placeholder for potential async packaging logic (e.g., upload, compression)
        await self._log(f"Packaging successful build for {arch}", artifact=artifact_path, arch=arch)
        # Simulate some async work if needed
        # await asyncio.sleep(0.1)

# </End of class definition>

# ---------------- Example Usage ----------------

async def main():
    # Example: Setup StreamWriter to write to stdout
    # This is a common way to get an async writer for stdout
    loop = asyncio.get_running_loop()
    stdout_transport, stdout_protocol = await loop.connect_write_pipe(
        asyncio.streams.FlowControlMixin, # A basic protocol mixin
        sys.stdout # The target pipe
    )
    log_writer = asyncio.StreamWriter(stdout_transport, stdout_protocol, None, loop) # type: ignore[arg-type]


    print("--- Starting Async MegaBuilder ---") # Regular print before handing over to async logger

    builder = MegaBuilder(log_writer=log_writer, config={
        "targets": ["x86", "arm", "riscv"],
        "opt_level": 3,
        "features": {"simd": False} # Test failure case for vectorize pass
    })
    await builder.build_all(artifacts_dir="/tmp/mega_build_artifacts")

    print("--- Async MegaBuilder Finished ---")

    # Clean up the writer/transport if necessary (may depend on specific use case)
    # log_writer.close()
    # await log_writer.wait_closed() # Ensure cleanup completes
    # Note: Closing stdout pipe might cause issues if other parts of the app use stdout later.
    # For simple scripts, letting the program exit might be sufficient.

if __name__ == "__main__":
    # To prevent errors on Windows:
    if sys.platform == "win32":
         asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nBuild cancelled by user.")
