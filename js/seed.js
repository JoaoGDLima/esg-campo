// Modelo inicial de questionário ESG para propriedades rurais.
// É um ponto de partida: revise com a equipe técnica antes de usar em campo.
import { uid } from './db.js';

const c = (text, extra = {}) => ({ type: 'conform', text, help: '', weight: 1, required: true, critical: false, photoOnNC: false, ...extra });
const yn = (text, extra = {}) => ({ type: 'yesno', expected: 'sim', text, help: '', weight: 1, required: true, critical: false, photoOnNC: false, ...extra });

const SECTIONS = [
  { pillar: 'E', title: 'Regularidade ambiental', questions: [
    c('Imóvel inscrito no CAR (Cadastro Ambiental Rural) com situação ativa', { critical: true, weight: 3, help: 'Conferir o número do CAR e o recibo de inscrição.' }),
    c('Área de Reserva Legal delimitada e conservada conforme o Código Florestal', { weight: 2, photoOnNC: true }),
    c('Áreas de Preservação Permanente (nascentes, margens de rios, encostas) preservadas ou em recuperação', { critical: true, weight: 3, photoOnNC: true }),
    c('Ausência de desmatamento ou conversão de vegetação nativa sem autorização', { critical: true, weight: 3 }),
    c('Ausência de uso de fogo sem autorização do órgão ambiental', { weight: 2 }),
    c('Outorga ou dispensa de outorga para uso de recursos hídricos, quando aplicável'),
  ]},
  { pillar: 'E', title: 'Solo, insumos e resíduos', questions: [
    c('Práticas de conservação do solo (plantio direto, curvas de nível, cobertura)', { photoOnNC: true }),
    yn('Análise de solo realizada nos últimos 3 anos?'),
    c('Aplicações de agrotóxicos com receituário agronômico', { weight: 2, help: 'Solicitar os receituários das últimas aplicações.' }),
    c('Agrotóxicos armazenados em local exclusivo, ventilado, trancado e sinalizado', { weight: 2, photoOnNC: true }),
    c('Tríplice lavagem e devolução das embalagens vazias com comprovante', { weight: 2 }),
    c('Destinação adequada de resíduos sólidos e efluentes/dejetos animais', { photoOnNC: true }),
    yn('Utiliza alguma fonte de energia renovável (solar, biogás, etc.)?', { required: false, weight: 0.5 }),
  ]},
  { pillar: 'S', title: 'Condições de trabalho', questions: [
    { type: 'number', text: 'Número de trabalhadores contratados (permanentes e temporários)', help: '', weight: 1, required: true, critical: false, photoOnNC: false },
    c('Trabalhadores com registro formal (CTPS) ou contrato conforme a legislação', { critical: true, weight: 3 }),
    c('Ausência de trabalho infantil', { critical: true, weight: 3 }),
    c('Ausência de trabalho forçado ou em condição análoga à escravidão', { critical: true, weight: 3 }),
    c('EPIs fornecidos gratuitamente, com registro de entrega (NR-31)', { weight: 2, photoOnNC: true }),
    c('Trabalhadores que aplicam agrotóxicos possuem treinamento específico', { weight: 2 }),
    c('Instalações sanitárias, água potável e local para refeições adequados', { photoOnNC: true }),
    c('Material de primeiros socorros disponível'),
  ]},
  { pillar: 'S', title: 'Comunidade e desenvolvimento', questions: [
    yn('Participa de associação, cooperativa ou sindicato rural?', { weight: 0.5 }),
    yn('Produtor ou trabalhadores participaram de capacitação nos últimos 12 meses?'),
  ]},
  { pillar: 'G', title: 'Gestão e documentação', questions: [
    c('Documentação do imóvel regularizada (matrícula, CCIR, ITR)', { weight: 2 }),
    c('Licenciamento ambiental da atividade, quando aplicável', { weight: 2 }),
    c('Ausência de embargos ambientais (IBAMA / órgão estadual)', { critical: true, weight: 3 }),
    c('Caderno de campo / registros de manejo e rastreabilidade da produção'),
    { type: 'single', text: 'Como é feito o controle financeiro da propriedade?', help: '', weight: 1, required: true, critical: false, photoOnNC: false,
      options: [{ label: 'Não possui controle', score: 0 }, { label: 'Anotações informais', score: 0.5 }, { label: 'Planilha ou software de gestão', score: 1 }] },
    yn('Existe planejamento de sucessão familiar?', { required: false, weight: 0.5 }),
    { type: 'text', text: 'Observações gerais do orientador', help: '', weight: 1, required: false, critical: false, photoOnNC: false },
  ]},
];

export function defaultQuestionnaire() {
  return {
    title: 'Diagnóstico ESG – Propriedade Rural',
    description: 'Modelo inicial com itens ambientais, sociais e de governança. Ajuste conforme o programa.',
    sections: SECTIONS.map(s => ({
      id: uid(), pillar: s.pillar, title: s.title,
      questions: s.questions.map(q => ({ ...structuredClone(q), id: uid() })),
    })),
  };
}
