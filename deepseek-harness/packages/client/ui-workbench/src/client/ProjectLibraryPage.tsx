import type { CopyProps } from './contract.ts';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle, Trash2, FolderMinus } from 'lucide-react';
import type { ProjectSummary } from './project-api.ts';
import { ProjectTags } from './ProjectTagEditor.tsx';
import css from './workbench.module.css';
function formatTime(ms: number, t: CopyProps['t']): string {
    if (ms <= 0)
        return t("legacy.001");
    return new Date(ms).toLocaleDateString('zh-CN');
}
function projectTags(project: ProjectSummary): string[] { return Array.isArray(project.tags) ? project.tags : []; }
export interface ProjectLibraryPageProps extends CopyProps {
    list: () => Promise<ProjectSummary[]>;
    openProject: (projectPath: string) => Promise<void>;
    deleteProject: (projectPath: string) => Promise<void>;
    forgetProject: (projectPath: string) => Promise<void>;
    onBack: () => void;
}
/** Full project library surface. The page owns a fresh scan so mutations are visible immediately. */
export function ProjectLibraryPage({ list, openProject, deleteProject, forgetProject, onBack, t }: ProjectLibraryPageProps) {
    const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [openingPath, setOpeningPath] = useState<string | null>(null);
    const [deletingPath, setDeletingPath] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        list().then(value => {
            if (!cancelled)
                setProjects(value);
        }).catch(cause => {
            if (!cancelled)
                setError(String(cause instanceof Error ? cause.message : cause));
        });
        return () => { cancelled = true; };
    }, [list]);
    const handleOpen = async (path: string) => {
        if (openingPath !== null || deletingPath !== null)
            return;
        setError(null);
        setOpeningPath(path);
        try {
            await openProject(path);
        }
        catch (cause) {
            setError(t("legacy.002") + String(cause instanceof Error ? cause.message : cause));
        }
        finally {
            setOpeningPath(null);
        }
    };
    const handleDelete = async (project: ProjectSummary, forget = false) => {
        if (openingPath !== null || deletingPath !== null)
            return;
        if (!window.confirm(forget ? t('forgetConfirm') : t("legacy.003", { value0: project.name })))
            return;
        setError(null);
        setDeletingPath(project.path);
        try {
            await (forget ? forgetProject : deleteProject)(project.path);
            setProjects(previous => previous?.filter(item => item.path !== project.path) ?? []);
        }
        catch (cause) {
            setError(t("legacy.004") + String(cause instanceof Error ? cause.message : cause));
        }
        finally {
            setDeletingPath(null);
        }
    };
    return (<main className={css.libraryPage}>
      <header className={css.libraryPageHeader}>
        <button className={css.backButton} type="button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true"/>
          <span>{t("legacy.047")}</span>
        </button>
        <div>
          <span className={css.sectionKicker}>PROJECT LIBRARY</span>
          <h1 className={css.libraryPageTitle}>{t("legacy.007")}</h1>
        </div>
        <div className={css.libraryPageTools}>
          <span className={css.libraryPageCount}>{projects?.length ?? 0}{t("legacy.048")}</span>
        </div>
      </header>
      {error !== null && <p className={css.libraryPageError} role="alert">{error}</p>}
      <section className={css.libraryPageGrid} aria-label={t("legacy.007")} aria-busy={projects === null}>
        {projects === null ? (<>
            <div className={css.projectSkeleton}/>
            <div className={css.projectSkeleton}/>
            <div className={css.projectSkeleton}/>
            <div className={css.projectSkeleton}/>
          </>) : projects.length === 0 ? (<div className={css.emptyState}>{t("legacy.022")}<br /><span>{t("legacy.049")}</span></div>) : projects.map((project, index) => {
            const busy = openingPath === project.path || deletingPath === project.path;
            return (<article className={`${css.projectCard} ${css.projectCardContainer}`} key={project.path}>
              <button className={css.projectCardMain} type="button" onClick={() => void handleOpen(project.path)} disabled={busy || openingPath !== null || deletingPath !== null}>
                <span className={`${css.cardCover} ${css[`cover${index % 4}`]}`}><span>{t("legacy.050")}</span></span>
                <strong className={css.projectName}>{project.name}</strong>
                <span className={css.projectMeta}>{project.path}</span>
                <ProjectTags tags={projectTags(project)} limit={3} ariaLabel={t("legacy.034", { value0: projectTags(project).join('、') })}/>
                <span className={css.projectTime}>{formatTime(project.updatedAt, t)}</span>
                <span className={css.cardFooter}>{t("legacy.039")}<ArrowUpRight size={13} aria-hidden="true"/></span>
              </button>
              <button className={css.projectDelete} type="button" title={t('forgetProject')} aria-label={t('forgetProject')} onClick={() => void handleDelete(project, true)} disabled={busy || openingPath !== null || deletingPath !== null}><FolderMinus size={16} /></button>
              {project.canDelete === true && <button className={css.projectDelete} type="button" title={t('deleteProject')} aria-label={t("legacy.040", { value0: project.name })} onClick={() => void handleDelete(project)} disabled={busy || openingPath !== null || deletingPath !== null}>
                {deletingPath === project.path ? <LoaderCircle className={css.buttonSpinner} size={15} aria-hidden="true"/> : <Trash2 size={15} aria-hidden="true"/>}
              </button>}
            </article>);
        })}
      </section>
      {openingPath !== null && (<div className={css.transitionOverlay} role="status" aria-live="polite">
          <LoaderCircle className={css.loadingSpinner} size={24} aria-hidden="true"/>
          <span>{t("legacy.046")}</span>
        </div>)}
    </main>);
}
