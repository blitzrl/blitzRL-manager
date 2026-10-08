const listeners = new Set();

export const state = {
  route: 'dashboard',
  divisionId: null,
  seasonId: null,
  viewSeasonId: null,  // Fase 4: id de temporada archivada que se está viendo, o null para la activa
  params: []
};

export function setState(patch){
  Object.assign(state, patch);
  listeners.forEach(l => l(state));
}
export function subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn); }

const DIV_KEY = 'ZENITH_ACTIVE_DIVISION';

export function loadActiveDivision(){
  try{
    const id = localStorage.getItem(DIV_KEY);
    if(id) state.divisionId = id;
  }catch(_){}
}

export function saveActiveDivision(id){
  try{ localStorage.setItem(DIV_KEY, id); }catch(_){}
  state.divisionId = id;
}

export function getActiveDivisionId(){
  return state.divisionId;
}