import type { EmbodimentFrame, ForelegMuscleRates } from "./fly-embodiment";
import { buildFlyAnatomy, buildFlyLegs } from "./fly-mesh";

const VERTEX_SHADER = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec3 a_color;
uniform mat4 u_matrix;
uniform mat4 u_rotation;
varying vec3 v_color;
varying vec3 v_normal;
void main() {
  gl_Position = u_matrix * vec4(a_position, 1.0);
  v_color = a_color;
  v_normal = mat3(u_rotation) * a_normal;
}`;
const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 v_color;
varying vec3 v_normal;
uniform float u_opacity;
void main() {
  vec3 n = normalize(v_normal);
  if (!gl_FrontFacing) n = -n;
  vec3 key = normalize(vec3(-0.5, 0.8, 1.0));
  float diffuse = max(dot(n, key), 0.0);
  float fill = max(dot(n, normalize(vec3(0.8, 0.2, -0.6))), 0.0);
  float specular = pow(max(dot(n, normalize(key + vec3(0.0, 0.0, 1.0))), 0.0), 38.0);
  vec3 color = v_color * (0.38 + 0.65 * diffuse + 0.25 * fill) + vec3(0.22) * specular;
  gl_FragColor = vec4(color, u_opacity);
}`;

type GpuMesh = { buffer: WebGLBuffer; count: number };

/**
 * Interpolate committed embodiment poses for visualization; rendered leg motion is not an independent
 * behavioral measurement.
 */
export class FlyBodyView {
  private readonly gl: WebGLRenderingContext | null;
  private readonly fallback: CanvasRenderingContext2D | null;
  private readonly observer: ResizeObserver;
  private program: WebGLProgram | null = null;
  private body?: GpuMesh;
  private wings?: GpuMesh;
  private legs?: GpuMesh;
  private target = [0, 0];
  private angles = [0, 0];
  private activation = [0, 0, 0, 0];
  private dirty = true;
  private lastPaint = 0;
  private width = 640;
  private height = 320;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const candidate = typeof WebGLRenderingContext === "undefined" ? null : canvas.getContext("webgl", { antialias: true, alpha: true });
    this.gl = candidate;
    this.fallback = candidate ? null : canvas.getContext("2d");
    if (candidate) {
      this.program = createProgram(candidate);
      const anatomy = buildFlyAnatomy();
      this.body = this.upload(anatomy.body);
      this.wings = this.upload(anatomy.wings);
      this.legs = this.upload(buildFlyLegs(this.angles, this.activation));
      candidate.enable(candidate.DEPTH_TEST);
      candidate.enable(candidate.BLEND);
      candidate.blendFunc(candidate.SRC_ALPHA, candidate.ONE_MINUS_SRC_ALPHA);
    }
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  reset(): void {
    this.target = [0, 0]; this.angles = [0, 0]; this.activation = [0, 0, 0, 0];
    this.dirty = true; this.draw();
  }

  update(_rates: ForelegMuscleRates, embodiment: EmbodimentFrame): void {
    this.target = [...embodiment.jointAnglesRad];
    this.activation = [...embodiment.muscleActivation];
    this.dirty = true;
  }

  /**
   * Render within the application's animation loop at at most 30 Hz, independently of neural
   * integration.
   */
  render(now: number): void {
    if (now - this.lastPaint < 1000 / 30) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastPaint) / 1000));
    this.lastPaint = now;
    let moving = false;
    for (let i=0;i<2;i++) {
      const gap = this.target[i] - this.angles[i];
      if (Math.abs(gap)>0.0001) { this.angles[i] += gap*(1-Math.exp(-dt/0.045)); moving=true; }
      else this.angles[i] = this.target[i];
    }
    if (this.dirty || moving) this.draw();
  }

  private resize(): void {
    // Keep layout dimensions under CSS control to avoid canvas-resize feedback during inspection.
    this.width = Math.max(1,this.canvas.clientWidth || 640);
    this.height = Math.max(1,this.canvas.clientHeight || 320);
    const dpr = Math.min(2,window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width*dpr);
    this.canvas.height = Math.round(this.height*dpr);
    this.draw();
  }

  private upload(data: Float32Array): GpuMesh {
    const gl = this.gl!; const buffer=gl.createBuffer();
    if(!buffer) throw new Error("Unable to allocate fly mesh");
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    return {buffer,count:data.length/9};
  }

  private draw(): void {
    this.dirty=false;
    const gl=this.gl;
    if(!gl || !this.program || !this.body || !this.wings || !this.legs) {
      const c=this.fallback;
      if(c) { c.clearRect(0,0,this.canvas.width,this.canvas.height); c.fillStyle="#9db4d1"; c.font="14px sans-serif"; c.fillText("3D fly requires WebGL in this browser.",18,35); }
      return;
    }
    const data=buildFlyLegs(this.angles,this.activation);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.legs.buffer);
    gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
    this.legs.count=data.length/9;
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    // Choose a fixed oblique camera relative to the procedural head axis; camera orientation has no
    // neural effect.
    const rotation=multiply(rotationX(0.25),rotationY(-3*Math.PI/4));
    const aspect=this.width/this.height;
    const vertical=1.82*Math.max(1,1.35/aspect);
    const projection=orthographic(-vertical*aspect,vertical*aspect,-vertical,vertical,0.1,30);
    const matrix=multiply(projection,multiply(translation(0,0.15,-8),rotation));
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program,"u_matrix"),false,matrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program,"u_rotation"),false,rotation);
    const paint=(mesh: GpuMesh, opacity: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
      for(let i=0;i<3;i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i,3,gl.FLOAT,false,36,i*12); }
      gl.uniform1f(gl.getUniformLocation(this.program!,"u_opacity"),opacity);
      gl.drawArrays(gl.TRIANGLES,0,mesh.count);
    };
    paint(this.body,1); paint(this.legs,1);
    gl.depthMask(false); paint(this.wings,0.48); gl.depthMask(true);
  }
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program=gl.createProgram();
  if(!program) throw new Error("Unable to create fly renderer");
  for(const [type,source] of [[gl.VERTEX_SHADER,VERTEX_SHADER],[gl.FRAGMENT_SHADER,FRAGMENT_SHADER]] as const) {
    const shader=gl.createShader(type)!;
    gl.shaderSource(shader,source); gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)||"Fly shader failed");
    gl.attachShader(program,shader); gl.deleteShader(shader);
  }
  ["a_position","a_normal","a_color"].forEach((name,i)=>gl.bindAttribLocation(program,i,name));
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)||"Fly shader link failed");
  return program;
}
function orthographic(l:number,r:number,b:number,t:number,n:number,f:number): Float32Array {
  return new Float32Array([2/(r-l),0,0,0,0,2/(t-b),0,0,0,0,-2/(f-n),0,-(r+l)/(r-l),-(t+b)/(t-b),-(f+n)/(f-n),1]);
}
function translation(x:number,y:number,z:number): Float32Array { return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]); }
function rotationX(a:number): Float32Array { const c=Math.cos(a),s=Math.sin(a);return new Float32Array([1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1]); }
function rotationY(a:number): Float32Array { const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]); }
function multiply(a:Float32Array,b:Float32Array): Float32Array {
  const out=new Float32Array(16);
  for(let c=0;c<4;c++) for(let r=0;r<4;r++) out[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];
  return out;
}
