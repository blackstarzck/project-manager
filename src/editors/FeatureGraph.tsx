import { useEffect, useState } from 'react';
import { Background, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Node, type NodeProps, type Edge } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { GraphControls } from '../components/GraphControls';
import { Expand, FileText, Layers, Star } from 'lucide-react';
import type { Feature } from '../../shared/schema';

function FeatureGraphNode({ data }: NodeProps) {
  const feature = data.feature as Feature | undefined;
  return <div className={`feature-graph-node ${data.active ? 'active' : ''} graph-${feature?.kind || 'root'}`}><Handle type="target" position={Position.Left}/><div className="feature-graph-meta">{feature ? <Layers size={11}/> : <FileText size={11}/>}<span>{feature?.kind === 'requirement' ? '요구사항' : feature?.kind === 'feature' ? '기능' : feature ? '상세 기능' : '프로젝트'}</span>{feature?.favorite && <Star size={10} style={{ marginLeft: 'auto' }} fill="#c0a36a" color="#c0a36a"/>}</div><strong>{String(data.label)}</strong>{feature?.description && <p>{feature.description}</p>}<Handle type="source" position={Position.Right}/></div>;
}
const types = { feature: FeatureGraphNode };
function GraphContent({ name, features, selected, onSelect }: { name: string; features: Feature[]; selected: string | null; onSelect: (id: string) => void }) {
  const [nodes, setNodes] = useState<Node[]>([]), [edges, setEdges] = useState<Edge[]>([]);
  const { fitView } = useReactFlow();
  useEffect(() => {
    let cancelled = false;
    const nextEdges: Edge[] = features.map(f => ({ id: `edge:${f.id}`, source: f.parentId || '__project__', target: f.id, type: 'default', style: { stroke: f.kind === 'requirement' ? '#d5c1ee' : f.kind === 'feature' ? '#b9d9df' : '#dbc5d7', strokeWidth: 1.4 } }));
    void new ELK().layout({ id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '30', 'elk.layered.spacing.nodeNodeBetweenLayers': '70' }, children: [{ id: '__project__', width: 240, height: 142 }, ...features.map(f => ({ id: f.id, width: 240, height: 142 }))], edges: nextEdges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })) }).then(graph => { if (cancelled) return; setNodes((graph.children || []).map(node => ({ id: node.id, type: 'feature', data: { label: node.id === '__project__' ? name : features.find(f => f.id === node.id)?.title, feature: features.find(f => f.id === node.id) }, position: { x: node.x || 0, y: node.y || 0 } }))); setEdges(nextEdges); setTimeout(() => { if (!cancelled) void fitView({ padding: .2, maxZoom: 1 }); }, 80); }).catch(() => { if (cancelled) return; setNodes(features.map((f,i) => ({ id: f.id, type: 'feature', data: { label: f.title, feature: f }, position: { x: f.kind === 'requirement' ? 0 : f.kind === 'feature' ? 280 : 560, y: i*172 } }))); setEdges(nextEdges.filter(e => e.source !== '__project__')); });
    return () => { cancelled = true; };
  }, [features, name]);
  return <div className="feature-graph-canvas" data-export="features"><ReactFlow nodes={nodes.map(node => ({ ...node, data: { ...node.data, active: selected === node.id } }))} edges={edges} nodeTypes={types} nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} onNodeClick={(_,node) => { if (node.id !== '__project__') onSelect(node.id); }} minZoom={.15} maxZoom={1.5} fitView><Background gap={21} size={1} color="#e0dce7"/><GraphControls label="기능 그래프 보기 도구"/><button className="graph-fit-button secondary small" onClick={() => void fitView({ duration: 300, padding: .2, maxZoom: 1 })}><Expand size={13}/>전체 보기</button></ReactFlow></div>;
}
export function FeatureGraph(props: { name: string; features: Feature[]; selected: string | null; onSelect: (id: string) => void }) { return <ReactFlowProvider><GraphContent {...props}/></ReactFlowProvider>; }
