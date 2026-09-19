# Neuroscience methods and modeling assumptions

This document specifies the implemented model. The [manuscript](../paper/main.tex) supplies equations, related work, and the complete pilot analysis. The [runtime audit](../paper/evidence/runtime-audit.json) records the actual defaults and annotation coverage.

## Structural observations versus model choices

MaleCNS contributes neuron identities, anatomical labels, directed contact counts, transmitter predictions, and available soma coordinates. The converter retains annotation records with a non-null superclass and edges between retained cells. An aggregated graph edge is a neuron pair, not a synaptic contact. The retained runtime has 166,700 neurons, 25,582,938 edges, and 124,177,617 summed contacts.

The following are added assumptions: transmitter-to-current polarity; contact-to-current scale; membrane/refractory dynamics; stochastic injection and release; intrinsic drive; motor homeostasis; sensor geometry; proprioceptive tuning; muscle/joint mechanics; reward semantics; structural action masks; and plasticity. None is fitted here to recordings from the reconstructed specimen.

## Annotation-grounded interfaces

Photoreceptors are selected by type/class/modality/subtype matching. R7/R8 coordinates are supplied by published optic-column assignments; R1–R6 inherit the strongest assigned L1 partner's column. A known photoreceptor soma can serve as a reported positional proxy when explicit mapping is absent. Within-eye normalization and 8 × 4 bin projection do not provide calibrated visual angles. The current mixed mapping covers 5,868 of 6,091 candidate receptors and 49 of 64 image channels.

Motor selection requires annotation-matched motor identity, laterality, and tibia flexor/extensor action. Forelegs are used when resolvable; otherwise the mapper may report side-specific aggregate pools. The current audit reports foreleg scope and groups `[15, 2, 14, 2]`. This is an operational annotation result, not independent validation of every classification.

Proprioceptor matching selects chordotonal, campaniform, or related proprioceptive labels and pools them by side. There are 735 mapped left and 718 mapped right cells. The same joint-dependent rate is supplied to each cell on a side, omitting receptor-specific tuning and distinctions between limb segments. Teaching-cell matching resolves 394 dopamine candidates.

IDs index data but do not establish sensor/muscle roles. Reservoir membership and seeded stochastic sequences still depend on graph order; annotation invariance under reordering does not imply trajectory invariance.

## Observation encoding

The camera area-pools two overlapping 86%-width crops into 64 channels. Intensity is the weighted RGB sum `(0.2126R + 0.7152G + 0.0722B) / 255`, not calibrated irradiance. A channel drive is clipped to `[0, 1]` after adding constant baseline `0.01`, luminance gain `0.8`, and temporal-contrast gain `4`.

The adaptation coefficient is `1 - exp(-dtMs / 45)`. **It is applied once per batch**, giving an effective 180 ms time constant with the default four-tick batch, rather than the nominal 45 ms parameter. Receptor injection probability is `220 × drive × dtMs / 1000` per tick. This discrete Bernoulli process is additionally constrained by refractoriness.

Proprioceptive rate is `clip(25 + 35 × angle/(π/2) + 25 × velocity/2.2, 0, 180)` Hz. The brain receives measured joint state, image channels, and labeled teaching events. It receives no direct ball/paddle coordinates; side/action credit labels are an additional engineered task signal.

## Sparse dynamics

The active CPU model has 4 ms ticks and four ticks per default batch. Active cells integrate an exponentially decaying membrane (20 ms) and signed synaptic accumulator (5 ms), with resting voltage −52, threshold −45, floor −80, and coupling gain 0.8. These are model units with a phenomenological voltage interpretation. A spike resets voltage to rest, clears synaptic state, and imposes two refractory ticks.

Contacts supply base edge magnitude `0.0275 × count`. Internal sources have release probability `1 - exp(-0.16 × count)` and gain 0.85. External sensory/teaching sources bypass that release draw and use gain one. Accumulated signed input is bounded to ±16. ACh is positive, GABA negative, and optic sensory histamine negative under the declared convention; other unresolved signs transmit zero. This disables outgoing current on 5,837,334 stored edges from 34,813 cells.

Dormant subthreshold accumulators decay in a pending list. Input magnitude 0.1 wakes membrane integration; residual magnitude below 0.01 is discarded. Near-rest cells leave the active list. Dormant cells consequently do not receive continuous membrane noise or full integration. Sparse execution is an approximation whose thresholds and timestep require sensitivity analysis.

An intrinsic reservoir of up to 4,096 non-external sign-resolved cells receives assumed 1.5 Hz drive. Motor thresholds adapt toward 24 Hz with gain 0.012 per batch per Hz of clipped rate error and bound ±7.3. Homeostasis remains active with learning disabled and is batch-dependent.

## Event-gated plasticity

At most 100,000 existing edges are selected by deterministic reservoir sampling from sign-resolved sensory-to-motor paths of at most eight edges. Each edge has a four-bit reachability mask for the motor pools. Shared upstream edges may belong to several actions; masks are not exclusive causal labels.

Each tick first decays eligibility and pre/post traces. A presynaptic event subtracts `0.012 × postTrace` and saturates its pre-trace at one; a postsynaptic event then adds `0.01 × preTrace` and saturates its post-trace at one. Eligibility is clipped to ±1. Same-tick coincidences are affected by that update order.

Timing traces decay by `0.995^40`, corresponding to approximately 19.95 ms. Eligibility decays by `0.9995^40`, corresponding to **199.95 ms**. An isolated trace retains only about 0.000335 of its value after 1.6 seconds. Ongoing activity can replenish eligibility, but the configured trace alone does not span a multi-second rally.

Hits emit +1, misses −1, and other frames zero. There is no continuous alignment reward. An event captures eligibility before teaching stimulation and waits up to 32 ms for any mapped teaching-cell spike. It is applied once or expires. Hits request stochastic 120 Hz teaching stimulation; misses request probability-one input for one batch through the same population. Missing teaching cells cannot be replaced by an implied biological gateway.

For side-labeled gameplay, rectified snapshot eligibility updates matching edge magnitudes by `baseWeight × 0.08 × reward × max(0, eligibility)`, bounded to `[0.25, 2] × baseWeight`. Generic unlabeled callers retain signed eligibility. Magnitude changes keep the transmitter sign fixed; increasing an inhibitory weight does not necessarily promote the structurally reachable motor action.

The positive display dopamine pulse and decaying `pain` display have arbitrary units. `painSpikes` and dopamine spikes during misses overlap because the same teaching population is reused. No validated nociceptor population or dopamine-concentration model is implemented.

## Embodiment and outcome interpretation

Filter pool rates for 50 ms before 45 Hz saturation; then apply 26/110 ms rise/fall activation. Antagonist difference drives joint dynamics with passive restoring force, nonlinear limits, bilateral gain adaptation, and endpoint-bias memory. The angle is bounded to ±π/2 and mapped through a sine to paddle position. Pong separately imposes 330 px/s maximum travel.

These actuator mechanisms can shape movement without useful visual processing. Action labels derive from antagonist activation rather than complete physical torque, with displacement as a fallback. They should be treated as an experimental credit heuristic.

The paired runner counts returned hit/miss events on both sides. The browser's `state.hits` counter currently counts only left hits. A fresh game constructor also has a different first vertical serve velocity from an explicit reset, and fixed-duration runs do not flush their final generated event. Preserve these qualifications when comparing browser and offline results.

Successful software tests establish implemented behavior, not validated physiology. The present [pilot](EXPERIMENTS.md) shows weight changes without observed held-out improvement.
