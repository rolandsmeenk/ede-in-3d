import {
  If, Fn, asin, atan, dFdx, dFdy, dot, float, floor, fract, max, mix, select, smoothstep,
  uniform, vec2, vec3
} from 'three/tsl';
import { Vector2 } from 'three/webgpu';

const MOVEMENT_PREFERENCE = '(prefers-reduced-motion: reduce)';

function softenSolarGlare(sky, strength, shoulder, ceiling) {
  const peak = max(max(sky.r, sky.g), sky.b);
  sky.divAssign(peak.sub(shoulder).max(0).mul(strength).div(ceiling).add(1));
}

function starField(sky, ray, transmission, extinction, strength) {
  // Cube faces let the grid keep an angular footprint at the zenith.
  const axis = ray.abs().toVar();
  const useX = axis.x.greaterThanEqual(axis.y).and(axis.x.greaterThanEqual(axis.z));
  const useY = axis.y.greaterThanEqual(axis.z);
  const major = select(useX, ray.x, select(useY, ray.y, ray.z)).toVar();
  const plane = select(useX, ray.zy, select(useY, ray.xz, ray.xy)).div(major.abs());
  const grid = plane.mul(96).add(96).toVar();
  const cell = floor(grid).toVar();
  const face = select(useX, 1, select(useY, 2, 3)).mul(major.sign());
  const key = cell.add(vec2(face.mul(215), face.mul(59)));
  const hash = fract(key.xyx.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  hash.addAssign(dot(hash, hash.yxz.add(33.33)));
  const random = fract(hash.xxy.add(hash.yzz).mul(hash.zyx)).toVar();
  const population = major.abs().pow(3).mul(0.058);
  const pixel = max(dFdx(ray).length(), dFdy(ray).length()).toVar();

  If(random.z.lessThan(population), () => {
    const magnitude = random.z.div(population).oneMinus().pow(5);
    const coord = cell.add(random.xy.mul(0.62).add(0.19)).sub(96).div(96).toVar();
    const sign = major.sign();
    const source = select(useX, vec3(sign, coord.y, coord.x),
      select(useY, vec3(coord.x, sign, coord.y), vec3(coord.x, coord.y, sign))).normalize();
    const distance = ray.sub(source).length();
    const size = mix(0.00051, 0.00138, magnitude);
    const width = max(pixel.mul(0.71), size);
    const core = smoothstep(width.mul(0.18), width, distance).oneMinus();
    const light = width.reciprocal().mul(size).pow(2).mul(core).mul(magnitude.mul(0.98).add(0.22));
    const color = mix(vec3(0.65, 0.79, 1.00), vec3(1.00, 0.79, 0.60), random.x);
    const visibility = smoothstep(0.05, 0.34, ray.y).mul(transmission.pow(5)).mul(strength);
    sky.addAssign(color.mul(extinction).mul(light).mul(visibility));
  });
}

function auroraCurtain(azimuth, elevation, phase) {
  const folds = azimuth.mul(5.4).add(phase).sin().mul(0.050)
    .add(azimuth.mul(11.5).sub(phase.mul(2)).add(0.7).sin().mul(0.026))
    .add(azimuth.mul(23).add(phase).sin().mul(0.011));
  const height = elevation.sub(folds).toVar();
  // Field-aligned filaments lean with each fold and keep their shape as the curtain moves.
  const lean = azimuth.mul(4).add(phase).sin().mul(0.22).add(0.18);
  const filament = azimuth.sub(height.mul(lean)).toVar();
  const pleats = filament.mul(69).add(filament.mul(18).add(phase).sin().mul(2.4))
    .sin().mul(0.5).add(0.5).pow(3);
  const texture = pleats.mul(0.54).add(filament.mul(103).sub(phase).sin().mul(0.07)).add(0.47);
  const patch = azimuth.mul(7.7).add(azimuth.mul(3.2).sub(phase).sin().mul(1.7))
    .add(phase).sin().mul(0.35).add(0.65);
  const wings = smoothstep(0.47, 1.17, azimuth.abs()).oneMinus();
  const green = smoothstep(-0.018, 0.022, height).mul(height.max(0).mul(-13).exp());
  const top = azimuth.mul(8.2).add(phase).sin().mul(0.035).add(0.148);
  const magenta = smoothstep(0.025, 0.10, height)
    .mul(height.sub(top).abs().mul(10).pow(2).negate().exp())
    .mul(smoothstep(0.23, 0.38, height).oneMinus());
  return vec3(0.055, 0.52, 0.24).mul(green).add(vec3(0.25, 0.027, 0.16).mul(magenta))
    .mul(texture).mul(patch).mul(wings);
}

const zigzag = Fn(([position]) => {
  const section = floor(position).toVar();
  const start = fract(section.mul(47.21).sin().mul(3843.21));
  const end = fract(section.add(1).mul(47.21).sin().mul(3843.21));
  return mix(start, end, fract(position)).sub(0.5);
});

export function createPhotoSky() {
  const rainbow = uniform(0);
  const sunbeams = uniform(0);
  const storm = uniform(0);
  const stars = uniform(0);
  const aurora = uniform(0);
  const auroraDirection = uniform(new Vector2(0, -1));
  const auroraElevation = uniform(13 * Math.PI / 180);
  const auroraPhase = uniform(0);
  const auroraVisibility = uniform(1);
  const lightning = uniform(0);
  const strike = uniform(new Vector2(1, 0));
  const reducedMotion = globalThis.matchMedia?.(MOVEMENT_PREFERENCE);
  let stormStart = null;

  function update(effects, timeSeconds) {
    rainbow.value = effects?.rainbow ?? 0;
    sunbeams.value = effects?.sunbeams ?? 0;
    storm.value = effects?.storm ?? 0;
    stars.value = effects?.stars ?? 0;
    aurora.value = Number.isFinite(effects?.aurora) ? Math.min(1, Math.max(0, effects.aurora)) : 0;
    if (aurora.value > 0) {
      const bearing = Number.isFinite(effects.auroraBearing) ? effects.auroraBearing : 0;
      const elevation = Number.isFinite(effects.auroraElevation) ? effects.auroraElevation : 13;
      const heading = (bearing % 360) * Math.PI / 180;
      auroraDirection.value.set(Math.sin(heading), -Math.cos(heading));
      auroraElevation.value = Math.max(0, Math.min(60, elevation)) * Math.PI / 180;
      auroraPhase.value = reducedMotion?.matches || effects.reducedMotion || effects.auroraReducedMotion
        || !Number.isFinite(timeSeconds) ? 0 : (timeSeconds * 0.14) % (2 * Math.PI);
      const haze = Math.max((effects.fog ?? 0) * (effects.blend ?? 1), effects.mist ?? 0);
      auroraVisibility.value = 1 - Math.min(1, Math.max(0, haze));
    }
    lightning.value = 0;

    if (!storm.value || !Number.isFinite(timeSeconds)) {
      stormStart = null;
      return;
    }

    stormStart ??= timeSeconds;
    if (reducedMotion?.matches || effects?.reducedMotion) return;
    const elapsed = timeSeconds - stormStart;
    const pulse = (elapsed + 15) % 18;
    if (pulse >= 0.86) return;
    const lightningIndex = Math.floor((elapsed + 15) / 18);
    const angle = Math.sin(lightningIndex * 2.4) * 0.83;
    strike.value.set(Math.cos(angle), Math.sin(angle));
    const envelope = Math.min(1, pulse / 0.16) * (1 - pulse / 0.86) ** 2;
    lightning.value = envelope * storm.value;
  }

  function composite(sky, ray, cloudTransmission, extinction, sunDirection, nightFactor = float(0), sampleCloudTransmission) {
    const daylight = smoothstep(0.30, 0.65, nightFactor).oneMinus();
    const alignment = dot(ray, sunDirection).toVar();
    If(rainbow.mul(daylight).greaterThan(0).and(ray.y.greaterThan(0)).and(alignment.lessThan(-0.735))
      .and(alignment.greaterThan(-0.773)), () => {
      const angleCosine = alignment.negate();
      const red = smoothstep(0.735, 0.742, angleCosine).mul(smoothstep(0.744, 0.753, angleCosine).oneMinus());
      const green = smoothstep(0.743, 0.752, angleCosine).mul(smoothstep(0.754, 0.763, angleCosine).oneMinus());
      const blue = smoothstep(0.750, 0.760, angleCosine).mul(smoothstep(0.765, 0.773, angleCosine).oneMinus());
      const violet = smoothstep(0.758, 0.765, angleCosine).mul(smoothstep(0.767, 0.773, angleCosine).oneMinus());
      const spectrum = vec3(red.add(violet.mul(0.27)), green.mul(0.78), blue.mul(0.92));
      const horizon = smoothstep(0.001, 0.036, ray.y);
      // The drops are in front of the cloud deck, so clouds influence contrast without occluding the arc.
      const rainCurtain = ray.x.mul(5).add(ray.z.mul(9)).sin().mul(0.18).add(0.82);
      sky.addAssign(spectrum.mul(extinction.max(0.29)).mul(horizon).mul(rainbow).mul(daylight).mul(rainCurtain).mul(0.29));
    });

    const solarHaze = smoothstep(0.57, 0.95, alignment);
    If(sunbeams.mul(daylight).greaterThan(0).and(alignment.greaterThan(0.57)), () => {
      const disc = smoothstep(0.99985, 0.99997, alignment).mul(cloudTransmission);
      softenSolarGlare(sky, solarHaze.mul(sunbeams).mul(daylight), 0.20, disc.mul(0.74).add(0.58));
    });

    if (sampleCloudTransmission) {
      If(sunbeams.mul(daylight).greaterThan(0).and(ray.y.greaterThan(0)).and(alignment.greaterThan(0.64)), () => {
        const radial = ray.sub(sunDirection.mul(alignment)).toVar();
        const spread = radial.length().toVar();
        // Project the view ray toward a ring around the Sun to carry cloud shadows through the haze.
        const radius = spread.mul(0.12).add(0.165);
        const lightPath = sunDirection.add(radial.mul(radius).div(spread.max(0.001))).toVar();
        const height = lightPath.y;
        lightPath.y.assign(height.mul(height).add(0.0016).sqrt().add(height).mul(0.5).add(0.018));
        const gap = sampleCloudTransmission(lightPath.normalize());
        const beyondDisc = smoothstep(0.025, 0.13, spread);
        const taper = smoothstep(0.64, 0.91, alignment).mul(smoothstep(0.002, 0.067, ray.y));
        const volume = taper.mul(beyondDisc).mul(sunbeams).mul(daylight);
        const foreground = cloudTransmission.mul(0.34).add(0.66);
        const light = gap.mul(foreground).mul(volume);
        const warm = mix(vec3(0.78, 0.39, 0.14), vec3(1.0, 0.73, 0.42), smoothstep(0.03, 0.16, sunDirection.y));
        sky.mulAssign(gap.oneMinus().mul(volume).mul(0.20).oneMinus());
        sky.addAssign(warm.mul(extinction.max(0.16)).mul(light).mul(0.58));
      });
    }

    If(storm.greaterThan(0).and(alignment.greaterThan(0.57)), () => {
      softenSolarGlare(sky, solarHaze.mul(storm), 0.11, 0.33);
    });

    If(storm.greaterThan(0).and(ray.y.greaterThan(0)), () => {
      const opticalDepth = cloudTransmission.max(0.003).log().negate();
      const density = smoothstep(0.24, 5.1, opticalDepth);
      const ceiling = smoothstep(0.012, 0.28, ray.y);
      sky.mulAssign(mix(vec3(1), vec3(0.31, 0.40, 0.58), storm.mul(density).mul(ceiling)));
      const horizon = smoothstep(0.004, 0.032, ray.y)
        .mul(smoothstep(0.04, 0.24, ray.y).oneMinus())
        .mul(smoothstep(0.18, 0.96, alignment))
        .mul(smoothstep(-0.06, 0.04, sunDirection.y))
        .mul(smoothstep(0.05, 0.34, sunDirection.y).oneMinus());
      sky.addAssign(vec3(0.21, 0.077, 0.022).mul(horizon).mul(storm));

      If(lightning.greaterThan(0), () => {
        const direction = vec3(sunDirection.x.add(0.0001), 0, sunDirection.z).normalize();
        const azimuth = direction.mul(strike.x).add(vec3(direction.z.negate(), 0, direction.x).mul(strike.y));
        const facing = dot(ray, azimuth);
        If(facing.greaterThan(0.55), () => {
          const x = dot(ray, vec3(azimuth.z.negate(), 0, azimuth.x)).toVar();
          const glow = x.mul(4.5).pow(2).add(ray.y.sub(0.28).mul(4.5).pow(2)).negate().exp();
          const scatter = glow.mul(density.mul(0.8).add(0.2)).mul(0.26);
          const height = ray.y.mul(17).add(strike.y.mul(8)).toVar();
          const path = zigzag(height).mul(0.052).add(zigzag(height.mul(3.7)).mul(0.014))
            .add(ray.y.sub(0.22).mul(0.16)).toVar();
          const stroke = smoothstep(0.0005, 0.0023, x.sub(path).abs()).oneMinus()
            .mul(smoothstep(0.095, 0.14, ray.y))
            .mul(smoothstep(0.25, 0.38, ray.y).oneMinus());
          const forkPath = path.add(ray.y.sub(0.24).mul(0.62));
          const fork = smoothstep(0.0003, 0.0015, x.sub(forkPath).abs()).oneMinus()
            .mul(smoothstep(0.13, 0.16, ray.y)).mul(smoothstep(0.24, 0.245, ray.y).oneMinus());
          const bolt = stroke.add(fork.mul(0.44)).mul(cloudTransmission.mul(0.75).add(0.25));
          sky.addAssign(vec3(0.63, 0.70, 1.0).mul(scatter.add(bolt)).mul(lightning));
        });
      });
    });

    const darkness = smoothstep(0.55, 0.83, nightFactor);
    If(stars.mul(darkness).greaterThan(0), () => {
      starField(sky, ray, cloudTransmission, extinction, stars.mul(darkness));
    });
    const auroraStrength = aurora.mul(darkness).mul(auroraVisibility);
    const facing = dot(ray.xz, auroraDirection);
    If(auroraStrength.greaterThan(0).and(facing.greaterThan(0.08)).and(ray.y.greaterThan(0.006)), () => {
      const across = dot(ray.xz, vec2(auroraDirection.y.negate(), auroraDirection.x));
      const azimuth = atan(across, facing).toVar();
      const elevation = asin(ray.y.clamp(0, 1)).sub(auroraElevation).toVar();
      const near = auroraCurtain(azimuth, elevation.add(0.062), auroraPhase);
      const far = auroraCurtain(azimuth.add(0.31), elevation.sub(0.024), auroraPhase.negate().add(1.6));
      const horizon = smoothstep(0.006, 0.087, ray.y);
      const visibility = cloudTransmission.pow(2.6).mul(horizon).mul(auroraStrength);
      sky.addAssign(near.add(far.mul(0.52)).mul(extinction).mul(visibility));
    });
    return sky;
  }

  return { composite, update };
}
