#!/usr/bin/env julia
#=
OAE Plume Simulator using Oceananigans.jl
Simulates alkalinity plume dispersion from ship-based Ocean Alkalinity Enhancement

Usage: julia plume_simulator.jl input.json output.json
=#

using JSON3
using Oceananigans
using Oceananigans.Units

# Safety thresholds (from OAE research)
const ARAGONITE_SATURATION_MAX = 30.0  # Triggers runaway carbonate precipitation
const TOTAL_ALKALINITY_MAX = 3500.0    # µmol/kg, toxicity threshold for olivine

struct SimulationParams
    # Vessel parameters
    vessel_speed::Float64          # m/s, speed over ground
    waterline_length::Float64      # m
    discharge_rate::Float64        # m³/s, volume discharge rate
    flow_velocity::Float64         # m/s, at injection point
    discharge_diameter::Float64    # m, circular area of discharge

    # Feedstock parameters
    particle_radius::Float64       # m
    particle_density::Float64      # kg/m³
    feedstock_type::String         # "olivine" or "sodium_hydroxide"

    # Ocean state parameters
    temperature::Float64           # °C
    salinity::Float64              # PSU
    mixed_layer_depth::Float64     # m
    aragonite_saturation::Float64  # Ω_aragonite baseline
end

function load_params(input_file::String)::SimulationParams
    data = JSON3.read(read(input_file, String))

    return SimulationParams(
        get(data, :vessel_speed, 5.0),
        get(data, :waterline_length, 100.0),
        get(data, :discharge_rate, 0.1),
        get(data, :flow_velocity, 2.0),
        get(data, :discharge_diameter, 0.5),
        get(data, :particle_radius, 1e-5),
        get(data, :particle_density, 3300.0),
        get(data, :feedstock_type, "olivine"),
        get(data, :temperature, 15.0),
        get(data, :salinity, 35.0),
        get(data, :mixed_layer_depth, 50.0),
        get(data, :aragonite_saturation, 3.0)
    )
end

function check_safety_thresholds(aragonite_max::Float64, ta_max::Float64, feedstock::String)
    failures = String[]

    if aragonite_max > ARAGONITE_SATURATION_MAX
        push!(failures, "Aragonite saturation ($(round(aragonite_max, digits=2))) exceeds threshold ($(ARAGONITE_SATURATION_MAX)) - runaway carbonate formation risk")
    end

    if feedstock == "olivine" && ta_max > TOTAL_ALKALINITY_MAX
        push!(failures, "Total alkalinity ($(round(ta_max, digits=2)) µmol/kg) exceeds olivine toxicity threshold ($(TOTAL_ALKALINITY_MAX) µmol/kg)")
    end

    return failures
end

function run_simulation(params::SimulationParams; grid_size=(50, 50, 25), duration=3600.0)
    println("Initializing Oceananigans simulation...")
    println("  Grid: $(grid_size)")
    println("  Duration: $(duration)s")
    println("  Feedstock: $(params.feedstock_type)")

    # Domain size based on expected plume spread
    Lx, Ly, Lz = 500.0, 500.0, params.mixed_layer_depth

    # Create grid
    grid = RectilinearGrid(
        size = grid_size,
        x = (0, Lx),
        y = (-Ly/2, Ly/2),
        z = (-Lz, 0),
        topology = (Bounded, Bounded, Bounded)
    )

    # Background velocity (vessel wake approximation)
    u_background = params.vessel_speed * 0.1  # Wake velocity ~10% of vessel speed

    # Alkalinity tracer (represents dissolved alkalinity from feedstock)
    # Initial concentration at discharge point
    initial_alkalinity(x, y, z) = begin
        # Gaussian plume source at origin
        r² = x^2 + y^2 + (z + 5)^2  # Source at 5m depth
        σ = params.discharge_diameter * 2
        params.discharge_rate * exp(-r² / (2σ^2)) / (σ^3 * (2π)^1.5)
    end

    # Set up model with advection-diffusion for tracer
    model = NonhydrostaticModel(;
        grid = grid,
        advection = WENO(),
        timestepper = :RungeKutta3,
        tracers = (:alkalinity,),
        buoyancy = nothing,
        closure = ScalarDiffusivity(ν=1e-6, κ=1e-9)
    )

    # Set initial conditions
    set!(model, u=u_background, alkalinity=initial_alkalinity)

    # Run simulation
    simulation = Simulation(model, Δt=1.0, stop_time=duration)

    println("Running simulation...")
    run!(simulation)
    println("Simulation complete.")

    # Extract results
    alkalinity_data = interior(model.tracers.alkalinity)

    # Calculate derived quantities
    # Simplified aragonite saturation model (real model would use full carbonate chemistry)
    baseline_alk = 2300.0  # µmol/kg typical ocean alkalinity
    alk_field = alkalinity_data .* 1e6 .+ baseline_alk  # Convert to µmol/kg

    # Simplified Ω_aragonite calculation (proportional to alkalinity excess)
    aragonite_field = params.aragonite_saturation .+ (alk_field .- baseline_alk) ./ 100.0

    # Get grid coordinates for output
    xc = collect(grid.xᶜᵃᵃ[1:grid_size[1]])
    yc = collect(grid.yᵃᶜᵃ[1:grid_size[2]])
    zc = collect(grid.zᵃᵃᶜ[1:grid_size[3]])

    return (
        coordinates = (x=xc, y=yc, z=zc),
        alkalinity = alk_field,
        aragonite_saturation = aragonite_field,
        max_aragonite = maximum(aragonite_field),
        max_alkalinity = maximum(alk_field),
        grid_size = grid_size,
        duration = duration
    )
end

function generate_output(results, params::SimulationParams, output_file::String)
    safety_failures = check_safety_thresholds(
        results.max_aragonite,
        results.max_alkalinity,
        params.feedstock_type
    )

    output = Dict(
        "status" => isempty(safety_failures) ? "safe" : "unsafe",
        "safety_failures" => safety_failures,
        "coordinates" => Dict(
            "x" => results.coordinates.x,
            "y" => results.coordinates.y,
            "z" => results.coordinates.z
        ),
        "fields" => Dict(
            "alkalinity" => results.alkalinity,
            "aragonite_saturation" => results.aragonite_saturation
        ),
        "summary" => Dict(
            "max_aragonite_saturation" => results.max_aragonite,
            "max_total_alkalinity" => results.max_alkalinity,
            "grid_size" => results.grid_size,
            "simulation_duration_s" => results.duration
        ),
        "params" => Dict(
            "vessel_speed" => params.vessel_speed,
            "discharge_rate" => params.discharge_rate,
            "feedstock_type" => params.feedstock_type,
            "temperature" => params.temperature,
            "salinity" => params.salinity
        )
    )

    open(output_file, "w") do io
        JSON3.write(io, output)
    end

    println("Output written to: $output_file")
    println("Status: $(output["status"])")
    if !isempty(safety_failures)
        println("Safety failures:")
        for f in safety_failures
            println("  - $f")
        end
    end

    return output
end

function main()
    if length(ARGS) < 2
        println("Usage: julia plume_simulator.jl input.json output.json")
        println("       julia plume_simulator.jl --test")
        exit(1)
    end

    if ARGS[1] == "--test"
        println("Running test simulation with default parameters...")
        params = SimulationParams(
            5.0, 100.0, 0.1, 2.0, 0.5,  # vessel
            1e-5, 3300.0, "olivine",     # feedstock
            15.0, 35.0, 50.0, 3.0        # ocean
        )
        results = run_simulation(params; grid_size=(25, 25, 15), duration=600.0)
        generate_output(results, params, "test_output.json")
        return
    end

    input_file = ARGS[1]
    output_file = ARGS[2]

    println("Loading parameters from: $input_file")
    params = load_params(input_file)

    results = run_simulation(params)
    generate_output(results, params, output_file)
end

# Run if called directly
if abspath(PROGRAM_FILE) == @__FILE__
    main()
end
