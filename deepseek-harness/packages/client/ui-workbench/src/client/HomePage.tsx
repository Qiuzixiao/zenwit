import type { CopyProps } from './contract.ts';
/**
 * Zenwit home: a compact project control surface backed by the desktop
 * project-library API.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Clock3, FolderOpen, LoaderCircle, Plus, Search, Sparkles, Tags, Trash2, X, FolderMinus } from 'lucide-react';
import type { ProjectSummary } from './project-api.ts';
import { ProjectTagEditor, ProjectTags } from './ProjectTagEditor.tsx';
import css from './workbench.module.css';
type ProjectFilter = 'all' | 'untagged' | `tag:${string}`;
function formatTime(ms: number, t: CopyProps['t']): string {
    if (ms <= 0)
        return t("legacy.001");
    return new Date(ms).toLocaleDateString('zh-CN');
}
function projectTags(project: ProjectSummary): string[] {
    return Array.isArray(project.tags) ? project.tags : [];
}
function projectMatches(project: ProjectSummary, query: string): boolean {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized === '')
        return true;
    return [project.name, project.path, ...projectTags(project)]
        .some(value => value.toLocaleLowerCase().includes(normalized));
}
function tagsEqual(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((tag, index) => tag === right[index]);
}
/** Home page: project search, filtering, creation and selected-project actions. */
export function HomePage({ list, create, updateProjectTags, deleteProject, forgetProject, openProject, openLibrary, openFolder, t, ready = true, }: {
    list: () => Promise<ProjectSummary[]>;
    create: (name: string, tags: string[]) => Promise<ProjectSummary>;
    updateProjectTags: (projectPath: string, tags: string[]) => Promise<ProjectSummary>;
    deleteProject: (projectPath: string) => Promise<void>;
    forgetProject: (projectPath: string) => Promise<void>;
    openProject: (projectPath: string) => Promise<void>;
    openLibrary: () => void;
    openFolder: () => void;
    t: CopyProps['t'];
    ready?: boolean;
}) {
    const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [filter, setFilter] = useState<ProjectFilter>('all');
    const [query, setQuery] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [opening, setOpening] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [savingTags, setSavingTags] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [name, setName] = useState('');
    const [createTags, setCreateTags] = useState<string[]>([]);
    const [editingTags, setEditingTags] = useState(false);
    const [tagDraft, setTagDraft] = useState<string[]>([]);
    useEffect(() => {
        let cancelled = false;
        list().then(value => {
            if (cancelled)
                return;
            const sorted = [...value].sort((a, b) => b.updatedAt - a.updatedAt);
            setProjects(sorted);
            setSelectedPath(previous => previous !== null && sorted.some(project => project.path === previous)
                ? previous
                : sorted[0]?.path ?? null);
        }).catch(cause => {
            if (!cancelled)
                setError(String(cause instanceof Error ? cause.message : cause));
        });
        return () => { cancelled = true; };
    }, [list]);
    const sortedProjects = useMemo(() => [...(projects ?? [])].sort((a, b) => b.updatedAt - a.updatedAt), [projects]);
    const tagOptions = useMemo(() => {
        const tags = new Map<string, {
            label: string;
            count: number;
        }>();
        for (const project of sortedProjects) {
            for (const tag of projectTags(project)) {
                const key = tag.toLocaleLowerCase();
                const current = tags.get(key);
                tags.set(key, { label: current?.label ?? tag, count: (current?.count ?? 0) + 1 });
            }
        }
        return [...tags.entries()]
            .map(([key, value]) => ({ key: `tag:${key}` as const, ...value }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
    }, [sortedProjects]);
    const allTags = useMemo(() => tagOptions.map(option => option.label), [tagOptions]);
    const visibleProjects = useMemo(() => sortedProjects.filter(project => {
        const matchesFilter = filter === 'all'
            || (filter === 'untagged'
                ? projectTags(project).length === 0
                : projectTags(project).some(tag => `tag:${tag.toLocaleLowerCase()}` === filter));
        return matchesFilter && projectMatches(project, query);
    }), [filter, query, sortedProjects]);
    // Keep the detail pane aligned with the filtered list. When the current
    // selection is filtered out, promote the first visible project instead of
    // showing a stale detail record that is no longer in context.
    const selectedProject = visibleProjects.find(project => project.path === selectedPath)
        ?? visibleProjects[0]
        ?? null;
    useEffect(() => {
        if (filter.startsWith('tag:') && !tagOptions.some(option => option.key === filter))
            setFilter('all');
    }, [filter, tagOptions]);
    useEffect(() => {
        setEditingTags(false);
        setTagDraft(selectedProject === null ? [] : projectTags(selectedProject));
    }, [selectedProject?.path]);
    const openCreate = () => { setName(''); setCreateTags([]); setShowCreate(true); };
    const cancelCreate = () => { setShowCreate(false); setName(''); setCreateTags([]); setCreating(false); };
    const onOpenProject = async (project: ProjectSummary | null) => {
        if (!ready || project === null || opening || creating || deleting || savingTags)
            return;
        setSelectedPath(project.path);
        setError(null);
        setOpening(true);
        try {
            await openProject(project.path);
        }
        catch (cause) {
            setError(t("legacy.002") + String(cause instanceof Error ? cause.message : cause));
        }
        finally {
            setOpening(false);
        }
    };
    const onDeleteProject = async (project: ProjectSummary | null, forget = false) => {
        if (!ready || project === null || opening || creating || deleting || savingTags)
            return;
        if (!window.confirm(forget ? t('forgetConfirm') : t("legacy.003", { value0: project.name })))
            return;
        setError(null);
        setDeleting(true);
        try {
            await (forget ? forgetProject : deleteProject)(project.path);
            setProjects(previous => {
                const next = previous?.filter(item => item.path !== project.path) ?? [];
                setSelectedPath(next[0]?.path ?? null);
                return next;
            });
        }
        catch (cause) {
            setError(t("legacy.004") + String(cause instanceof Error ? cause.message : cause));
        }
        finally {
            setDeleting(false);
        }
    };
    const confirmCreate = async () => {
        const trimmed = name.trim();
        if (trimmed.length === 0 || creating || opening || deleting)
            return;
        setCreating(true);
        setError(null);
        try {
            const created = await create(trimmed, createTags);
            setProjects(previous => [created, ...(previous ?? [])]);
            setSelectedPath(created.path);
            setShowCreate(false);
            setName('');
            setCreateTags([]);
            setOpening(true);
            try {
                await openProject(created.path);
            }
            catch (cause) {
                setError(t("legacy.005") + String(cause instanceof Error ? cause.message : cause));
            }
            finally {
                setOpening(false);
            }
        }
        catch (cause) {
            setError(String(cause instanceof Error ? cause.message : cause));
        }
        finally {
            setCreating(false);
        }
    };
    const saveProjectTags = async (): Promise<void> => {
        if (selectedProject === null || savingTags || tagsEqual(projectTags(selectedProject), tagDraft)) {
            setEditingTags(false);
            return;
        }
        setSavingTags(true);
        setError(null);
        try {
            const updated = await updateProjectTags(selectedProject.path, tagDraft);
            setProjects(previous => previous?.map(project => project.path === updated.path ? updated : project) ?? []);
            setTagDraft(projectTags(updated));
            setEditingTags(false);
        }
        catch (cause) {
            setError(t("legacy.006") + String(cause instanceof Error ? cause.message : cause));
        }
        finally {
            setSavingTags(false);
        }
    };
    const filterOptions: Array<{
        key: ProjectFilter;
        label: string;
        count: number;
    }> = [
        { key: 'all', label: t("legacy.007"), count: sortedProjects.length },
        ...tagOptions,
        { key: 'untagged', label: t("legacy.008"), count: sortedProjects.filter(project => projectTags(project).length === 0).length },
    ];
    return (<main className={css.home}>
      <header className={css.homeNav}>
        <div className={css.navBrand} aria-label="Zenwit">
          <span className={css.brandMark} aria-hidden="true">Z</span>
          <strong>ZENWIT</strong>
          <span className={css.brandDivider} aria-hidden="true"/>
          <span className={css.brandContext}>{t("legacy.009")}</span>
        </div>
        <nav className={css.navLinks} aria-label={t("legacy.010")}>
          <button className={css.navActive} type="button" aria-current="page">{t("legacy.011")}</button>
          <button type="button" onClick={openLibrary}>{t("legacy.012")}</button>
        </nav>
        <div className={css.navTools}>
          <label className={css.searchBox}>
            <Search size={15} aria-hidden="true"/>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("legacy.013")} aria-label={t("legacy.013")}/>
          </label>
          <button className={css.newProjectButton} type="button" onClick={openCreate}>
            <Plus size={15} aria-hidden="true"/>
            <span>{t("legacy.014")}</span>
          </button>
          <button className={css.secondaryButton} type="button" onClick={openFolder}><FolderOpen size={15} />{t('openFolder')}</button>
        </div>
      </header>

      <section className={css.homeIntro} aria-labelledby="home-title">
        <div>
          <span className={css.sectionKicker}>ZENWIT / PROJECTS</span>
          <h1 id="home-title">{t("legacy.015")}</h1>
          <p>{t("legacy.016")}</p>
        </div>
        <div className={css.introRule} aria-hidden="true"/>
      </section>

      <section className={css.homeBody}>
        <aside className={css.filterPanel} aria-label={t("legacy.017")}>
          <div className={css.panelHeading}><Tags size={15} aria-hidden="true"/><span>{t("legacy.018")}</span></div>
          <div className={css.filterList} role="listbox" aria-label={t("legacy.018")}>
            {filterOptions.map(option => (<button key={option.key} className={`${css.filterOption} ${filter === option.key ? css.filterOptionActive : ''}`} type="button" role="option" aria-selected={filter === option.key} aria-label={`${option.label} ${option.count}`} onClick={() => setFilter(option.key)}>
                <span>{option.label}</span><span className={css.filterCount}>{option.count}</span>
              </button>))}
          </div>
          <div className={css.filterFooter}>
            <span className={css.statusDot} aria-hidden="true"/>
            <span>{t("legacy.019")}</span>
          </div>
        </aside>

        <section className={css.projectPanel} aria-labelledby="project-list-title">
          <div className={css.panelHeader}>
            <div>
              <span className={css.sectionKicker}>RECENT PROJECTS</span>
              <h2 id="project-list-title">{t("legacy.020")}</h2>
            </div>
            <button className={css.textAction} type="button" onClick={openLibrary}>{t("legacy.021")}<ChevronRight size={14} aria-hidden="true"/></button>
          </div>
          <div className={css.projectList}>
            {projects === null ? (<>
                <div className={css.projectRowSkeleton}/>
                <div className={css.projectRowSkeleton}/>
                <div className={css.projectRowSkeleton}/>
              </>) : visibleProjects.length === 0 ? (<div className={css.emptyState}>
                <FolderOpen size={22} aria-hidden="true"/>
                <strong>{sortedProjects.length === 0 ? t("legacy.022") : t("legacy.023")}</strong>
                <span>{sortedProjects.length === 0 ? t("legacy.024") : t("legacy.025")}</span>
                {sortedProjects.length === 0 && <button className={css.emptyAction} type="button" onClick={openCreate}><Plus size={14} aria-hidden="true"/>{t("legacy.026")}</button>}
              </div>) : visibleProjects.map(project => (<button key={project.path} className={`${css.projectRow} ${selectedProject?.path === project.path ? css.projectRowActive : ''}`} type="button" aria-pressed={selectedProject?.path === project.path} onClick={() => setSelectedPath(project.path)}>
                <span className={css.projectGlyph} aria-hidden="true"><FolderOpen size={17} strokeWidth={1.8}/></span>
                <span className={css.projectRowMain}>
                  <strong>{project.name}</strong>
                  <span className={css.projectRowMeta}>
                    <small>{project.path}</small>
                    <ProjectTags tags={projectTags(project)}/>
                  </span>
                </span>
                <span className={css.projectRowTime}><Clock3 size={13} aria-hidden="true"/>{formatTime(project.updatedAt, t)}</span>
                <ChevronRight className={css.projectRowChevron} size={16} aria-hidden="true"/>
              </button>))}
          </div>
        </section>

        <aside className={css.detailPanel} aria-label={t("legacy.027")}>
          {selectedProject === null ? (<div className={css.detailEmpty}><Sparkles size={20} aria-hidden="true"/><span>{t("legacy.028")}</span></div>) : (<>
              <div className={css.detailHeader}><span className={css.sectionKicker}>SELECTED PROJECT</span><span className={css.detailIndex}>01</span></div>
              <div className={css.detailIdentity}><span className={css.detailGlyph} aria-hidden="true"><FolderOpen size={20}/></span><h2>{selectedProject.name}</h2></div>
              <dl className={css.detailFacts}>
                <div><dt>{t("legacy.030")}</dt><dd>{formatTime(selectedProject.updatedAt, t)}</dd></div>
                <div><dt>{t("legacy.031")}</dt><dd title={selectedProject.path}>{selectedProject.path}</dd></div>
              </dl>
              <section className={css.detailTags} aria-label={t("legacy.018")}>
                <div className={css.detailTagsHeader}>
                  <span>{t("legacy.018")}</span>
                  {!editingTags && (<button type="button" onClick={() => { setTagDraft(projectTags(selectedProject)); setEditingTags(true); }}>
                      <Plus size={12} aria-hidden="true"/>{projectTags(selectedProject).length === 0 ? t("legacy.032") : t("legacy.033")}
                    </button>)}
                </div>
                {!editingTags ? (projectTags(selectedProject).length === 0
                ? <span className={css.detailTagsEmpty}>{t("legacy.008")}</span>
                : <ProjectTags tags={projectTags(selectedProject)} limit={8} ariaLabel={t("legacy.034", { value0: projectTags(selectedProject).join('、') })}/>) : (<div className={css.detailTagEditor}>
                    <ProjectTagEditor t={t} value={tagDraft} suggestions={allTags} disabled={savingTags} onChange={setTagDraft}/>
                    <div className={css.detailTagActions}>
                      <button type="button" disabled={savingTags} onClick={() => { setTagDraft(projectTags(selectedProject)); setEditingTags(false); }}>{t("legacy.035")}</button>
                      <button type="button" disabled={savingTags} onClick={() => void saveProjectTags()}>
                        {savingTags ? <LoaderCircle className={css.buttonSpinner} size={12} aria-hidden="true"/> : null}
                        {savingTags ? t("legacy.036") : t("legacy.037")}
                      </button>
                    </div>
                  </div>)}
              </section>
              <div className={css.detailActions}>
                <button className={css.detailPrimary} type="button" onClick={() => void onOpenProject(selectedProject)} disabled={!ready || opening || creating || deleting || savingTags}>
                  {opening ? <LoaderCircle className={css.buttonSpinner} size={15} aria-hidden="true"/> : <FolderOpen size={15} aria-hidden="true"/>}
                  {opening ? t("legacy.038") : t("legacy.039")}
                </button>
                <button className={css.detailDelete} type="button" title={t('forgetProject')} aria-label={t('forgetProject')} onClick={() => void onDeleteProject(selectedProject, true)} disabled={!ready || opening || creating || deleting || savingTags}><FolderMinus size={15} /></button>
                {selectedProject.available === false && <span role="status">{t('projectUnavailable')}</span>}
                {selectedProject.canDelete === true && <button className={css.detailDelete} type="button" title={t('deleteProject')} aria-label={t("legacy.040", { value0: selectedProject.name })} onClick={() => void onDeleteProject(selectedProject)} disabled={!ready || opening || creating || deleting || savingTags}>
                  {deleting ? <LoaderCircle className={css.buttonSpinner} size={15} aria-hidden="true"/> : <Trash2 size={15} aria-hidden="true"/>}
                </button>}
              </div>
            </>)}
        </aside>
      </section>

      {error !== null && <p className={css.homeError} role="alert">{error}</p>}

      {showCreate && (<div className={css.modalOverlay} onClick={cancelCreate}>
          <div className={css.modal} role="dialog" aria-modal="true" aria-label={t("legacy.026")} onClick={event => event.stopPropagation()}>
            <div className={css.modalHeader}><span className={css.sectionKicker}>NEW PROJECT</span><button className={css.modalClose} type="button" aria-label={t("legacy.041")} onClick={cancelCreate}><X size={15} aria-hidden="true"/></button></div>
            <h2 className={css.modalTitle}>{t("legacy.026")}</h2>
            <p className={css.modalDescription}>{t("legacy.042")}</p>
            <input className={css.modalInput} value={name} onChange={event => setName(event.target.value)} aria-label={t("legacy.043")} placeholder={t("legacy.043")} autoFocus onKeyDown={event => { if (event.key === 'Enter')
            void confirmCreate(); }}/>
            <div className={css.modalTagField}>
              <span>{t("legacy.018")}<small>{t("legacy.044")}</small></span>
              <ProjectTagEditor t={t} value={createTags} suggestions={allTags} disabled={creating} onChange={setCreateTags}/>
            </div>
            <div className={css.modalActions}>
              <button className={css.modalCancel} type="button" onClick={cancelCreate}>{t("legacy.035")}</button>
              <button className={css.modalConfirm} type="button" onClick={() => void confirmCreate()} disabled={creating}>
                {creating ? <><LoaderCircle className={css.buttonSpinner} size={14} aria-hidden="true"/>{t("legacy.045")}</> : <><Plus size={14} aria-hidden="true"/>{t("legacy.026")}</>}
              </button>
            </div>
          </div>
        </div>)}
      {opening && (<div className={css.transitionOverlay} role="status" aria-live="polite">
          <LoaderCircle className={css.loadingSpinner} size={20} aria-hidden="true"/>
          <span>{t("legacy.046")}</span>
        </div>)}
    </main>);
}
