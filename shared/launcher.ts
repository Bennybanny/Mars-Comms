export type NetworkInterface = {name:string;address:string};
export type LauncherConfig = {interfaceName:string;address:string;port:number;setupPort:number};
export type CertificateState = 'missing'|'ready'|'needs-update'|'expired'|'error';
export type CertificateStatus = {state:CertificateState;message:string;names:string[];expires?:string;caExpires?:string;fingerprint?:string};
export type LauncherSnapshot = {
  version:string;state:'Stopped'|'Starting'|'Running'|'Stopping'|'Error';
  config:LauncherConfig;interfaces:NetworkInterface[];selectionMissing:boolean;
  certificate:CertificateStatus;generating:boolean;mdns:'Available'|'Starting'|'Unavailable'|'Error'|'—';
  error?:string;notice?:string;url?:string;mdnsUrl?:string;setupUrl?:string;dataDirectory:string;
};
export type LauncherAPI = {
  snapshot:()=>Promise<LauncherSnapshot>;
  configure:(config:LauncherConfig)=>Promise<void>;
  generate:()=>Promise<void>;
  start:()=>Promise<void>;
  stop:()=>Promise<void>;
  exportCA:()=>Promise<boolean>;
  openIntercom:()=>Promise<void>;
  setupQR:()=>Promise<string>;
  importDatabase:()=>Promise<boolean>;
  onChange:(callback:(state:LauncherSnapshot)=>void)=>()=>void;
};
