export type Vec3 = [number, number, number];
type Color = Vec3;
export type Mesh = number[]; // Interleaved vertex position, surface normal, and display RGB; no physiological state.
const gold: Color = [0.53, 0.34, 0.15];
const dark: Color = [0.12, 0.085, 0.05];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1));
const vertex = (out: Mesh, p: Vec3, n: Vec3, c: Color) => out.push(...p, ...n, ...c);

function triangle(out: Mesh, a: Vec3, b: Vec3, c: Vec3, color: Color): void {
  const normal = unit(cross(sub(b, a), sub(c, a)));
  for (const p of [a, b, c]) vertex(out, p, normal, color);
}

function sphere(out: Mesh, center: Vec3, radius: Vec3, color: Color, segments = 24, rings = 14, faceted = false): void {
  const point = (r: number, s: number): Vec3 => {
    const phi = r / rings * Math.PI, theta = s / segments * 2 * Math.PI;
    return add(center, [radius[0]*Math.sin(phi)*Math.cos(theta), radius[1]*Math.cos(phi), radius[2]*Math.sin(phi)*Math.sin(theta)]);
  };
  for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
    const a = point(r,s), b = point(r+1,s), c = point(r+1,s+1), d = point(r,s+1);
    const tint = faceted ? scale(color, 0.85 + 0.15 * ((s * 13 + r * 7) % 5) / 4) : color;
    for (const tri of [[a,c,b], [a,d,c]]) {
      if (faceted) triangle(out, tri[0], tri[1], tri[2], tint);
      else for (const p of tri) vertex(out, p, unit(sub(p, center).map((v,i) => v / (radius[i]*radius[i])) as Vec3), tint);
    }
  }
}

function rod(out: Mesh, a: Vec3, b: Vec3, ra: number, rb: number, color: Color, sides = 8): void {
  const axis = unit(sub(b,a)), u = unit(cross(axis, Math.abs(axis[1]) < 0.9 ? [0,1,0] : [1,0,0])), v = cross(axis,u);
  const radial = (i: number) => add(scale(u, Math.cos(i/sides*Math.PI*2)), scale(v, Math.sin(i/sides*Math.PI*2)));
  for (let i = 0; i < sides; i++) {
    const n = radial(i), m = radial(i+1);
    const p = add(a,scale(n,ra)), q = add(a,scale(m,ra)), r = add(b,scale(n,rb)), s = add(b,scale(m,rb));
    for (const [point,normal] of [[p,n],[q,m],[s,m],[p,n],[s,m],[r,n]]) vertex(out, point, normal, color);
  }
}

/**
 * Cache procedural body geometry while rebuilding articulated legs from the reported pose; this mesh
 * is illustrative anatomy.
 */
export function buildFlyAnatomy(): { body: Float32Array; wings: Float32Array } {
  const body: Mesh = [], wings: Mesh = [];
  sphere(body,[0,0.13,-0.12],[0.44,0.47,0.65],gold,32,20);
  sphere(body,[0,0.04,0.79],[0.43,0.34,0.79],[0.45,0.29,0.11],32,20);
  // Use stylized tergite boundaries as visual landmarks, independent of connectome data.
  for (let band = 0; band < 6; band++) {
    const z = 0.42 + band * 0.19, t = (z - 0.79) / 0.79, f = Math.sqrt(1-t*t);
    for (let i = 0; i < 36; i++) {
      const at = (theta: number): Vec3 => [0.434*f*Math.cos(theta), 0.04+0.346*f*Math.sin(theta), z];
      rod(body,at(i/36*Math.PI*2),at((i+1)/36*Math.PI*2),0.021,0.021,dark,5);
    }
  }
  sphere(body,[0,0.07,-0.91],[0.37,0.35,0.30],[0.39,0.28,0.16]);
  for (const side of [-1,1]) {
    sphere(body,[side*0.265,0.13,-1.025],[0.237,0.29,0.205],[0.85,0.075,0.025],28,18,true);
    // Represent antennal segments schematically; this geometry provides no sensory input.
    sphere(body,[side*0.105,0.13,-1.25],[0.059,0.07,0.076],gold,12,8);
    sphere(body,[side*0.14,0.055,-1.33],[0.061,0.11,0.05],dark,12,8);
    const root: Vec3 = [side*0.14,0.10,-1.35], tip: Vec3 = [side*0.34,0.46,-1.44];
    rod(body,root,tip,0.009,0.002,gold,5);
    for (let i=1;i<6;i++) {
      const p=add(root,scale(sub(tip,root),i/6));
      rod(body,p,add(p,[side*0.10,0.05,0.015]),0.004,0.001,gold,4);
    }
    sphere(body,[side*0.43,-0.025,0.43],[0.06,0.075,0.06],[0.76,0.60,0.30],12,8);
    // Render fixed thoracic setae as anatomical context without adding mechanosensory channels.
    for (let row=0;row<5;row++) for (let i=0;i<6;i++) {
      const z=-0.55+row*0.19, theta=0.25+i*0.25;
      const f=Math.sqrt(Math.max(0,1-((z+0.12)/0.65)**2));
      const p: Vec3=[side*0.44*f*Math.cos(theta),0.13+0.47*f*Math.sin(theta),z];
      rod(body,p,add(p,[side*0.07,0.11,0.06]),0.006,0.001,[0.19,0.13,0.07],4);
    }
    buildWing(wings,side);
  }
  sphere(body,[0,-0.17,-1.16],[0.09,0.12,0.13],[0.34,0.24,0.12],12,8);
  for (const x of [-0.09,0,0.09]) sphere(body,[x,0.375,-0.94],[0.035,0.022,0.03],[0.10,0.045,0.024],8,5);
  return { body: new Float32Array(body), wings: new Float32Array(wings) };
}

function buildWing(out: Mesh, side: number): void {
  const root: Vec3 = [side*0.27,0.49,-0.20];
  const outline: Vec3[] = [root,[side*0.53,0.52,0.08],[side*0.81,0.49,0.59],[side*0.98,0.41,1.22],[side*0.94,0.36,1.58],[side*0.77,0.35,1.68],[side*0.57,0.38,1.49],[side*0.39,0.44,0.82]];
  const center: Vec3 = [side*0.61,0.45,0.76];
  for (let i=0;i<outline.length;i++) {
    const a=outline[i], b=outline[(i+1)%outline.length];
    triangle(out,center,a,b,[0.64,0.73,0.76]);
    rod(out,a,b,0.008,0.008,[0.40,0.45,0.40],5);
  }
  for (const i of [2,3,4,5,6]) rod(out,root,outline[i],0.009,0.004,[0.35,0.42,0.38],5);
  rod(out,outline[2],outline[7],0.005,0.005,gold,5);
  rod(out,outline[3],outline[6],0.005,0.005,gold,5);
}

/**
 * Apply fixed-length kinematics to display joint state; geometry does not participate in the actuator
 * dynamics.
 */
export function forelegPose(side: number, angle: number): Vec3[] {
  const hip: Vec3 = [side*0.29,-0.12,-0.53];
  const shoulder: Vec3 = [side*0.48,-0.30,-0.64];
  const knee: Vec3 = [side*0.79,-0.35,-1.03];
  // Preserve pose variation over the modeled joint range so display clipping cannot hide endpoint
  // behavior.
  const bend = -0.65 - angle;
  const direction: Vec3 = [side*0.46*Math.cos(bend),Math.sin(bend),-0.888*Math.cos(bend)];
  const ankle=add(knee,scale(unit(direction),0.68));
  const foot=add(ankle,scale(unit([side*0.2,Math.sin(bend-0.3)*0.55,-0.9]),0.29));
  return [hip,shoulder,knee,ankle,foot];
}

export function buildFlyLegs(angles: readonly number[], activation: readonly number[]): Float32Array {
  const out: Mesh=[];
  for (let s=0;s<2;s++) {
    const side=s===0?-1:1;
    for (let leg=0;leg<3;leg++) {
      const z=-0.53+leg*0.46;
      const pose: Vec3[]=leg===0?forelegPose(side,angles[s]):[
        [side*0.34,-0.12,z],[side*0.49,-0.30,z],
        [side*(leg===1?1.00:0.84),-0.48,z+0.15],
        [side*(leg===1?1.24:1.11),-0.99,z+0.48],
        [side*(leg===1?1.43:1.32),-1.02,z+0.68],
      ];
      for (let i=0;i<pose.length-1;i++) {
        const radius=[0.068,0.080,0.047,0.019][i];
        rod(out,pose[i],pose[i+1],radius,radius*0.65,gold,10);
        sphere(out,pose[i], [radius*1.08,radius*1.08,radius*1.08],dark,10,6);
        if (i===1 || i===2) for (let j=1;j<5;j++) {
          const p=add(pose[i],scale(sub(pose[i+1],pose[i]),j/5));
          rod(out,p,add(p,[side*0.06,-0.05,0.015]),0.005,0.001,dark,4);
        }
      }
      // Add schematic tarsal segments and claws solely for anatomical readability.
      for(let i=1;i<5;i++) {
        const p=add(pose[3],scale(sub(pose[4],pose[3]),i/5));
        sphere(out,p,[0.021,0.021,0.021],dark,8,5);
      }
      for(const direction of [-1,1]) rod(out,pose[4],add(pose[4],[direction*0.032,-0.035,-0.045]),0.010,0.002,dark,5);
      if(leg===0) {
        const strength=Math.min(1,Math.max(activation[s*2]||0,activation[s*2+1]||0));
        const color: Color = s===0 ? [0.15+0.1*strength,0.45+0.5*strength,0.55+0.4*strength] : [0.5+0.45*strength,0.26+0.2*strength,0.53+0.4*strength];
        sphere(out,pose[2],[0.055,0.055,0.055],color,12,8);
      }
    }
  }
  return new Float32Array(out);
}
