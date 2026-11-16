import Atmosphere from "@razzia/web/components/Atmosphere"
import QuestionEditorAnswers from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorAnswers"
import QuestionEditorConfig from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorConfig"
import QuestionEditorMedia from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorMedia"
import QuestionEditorTitle from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorTitle"
import { useQuizzEditor } from "@razzia/web/features/quizz/contexts/quizz-editor-context"

const QuestionEditor = () => {
  const { backgroundUrl } = useQuizzEditor()

  return (
    <div className="relative flex flex-col lg:flex-1 lg:flex-row lg:overflow-hidden">
      <Atmosphere recipe="photo" backgroundUrl={backgroundUrl} />
      <main className="@container relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 sm:p-6 lg:overflow-y-auto">
        <QuestionEditorTitle />
        <QuestionEditorMedia />
        <QuestionEditorAnswers />
      </main>
      <div className="relative z-10">
        <QuestionEditorConfig />
      </div>
    </div>
  )
}

export default QuestionEditor
