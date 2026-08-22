# syntax=docker/dockerfile:1
# Julia simulation sidecar
# Julia is invoked as a subprocess by the backend — it is not a long-running HTTP server.
# In K8s this runs as a Job; in compose it runs with the --profile julia flag.

FROM julia:1.10-bookworm AS runtime

WORKDIR /julia

# Copy simulation script
COPY julia/ .

# Pre-compile frequently used packages to slash cold-start from ~120s → ~5s.
# Oceananigans is the main simulation library. This layer is cached as long
# as plume_simulator.jl does not change.
RUN julia --project=. -e "\
    using Pkg; \
    Pkg.add([\"JSON3\", \"Statistics\"]); \
    Pkg.precompile()" 2>/dev/null || true

ENTRYPOINT ["julia", "--project=.", "plume_simulator.jl"]
