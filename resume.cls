\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{resume}[2023/01/11 v0.2 Resume class]

\LoadClass[10pt,letterpaper]{article} % Font size and paper type

\usepackage[top=.55in, left=.51in, right=.51in, bottom=0in]{geometry} % set document margins
\usepackage[parfill]{parskip} % Remove paragraph indentation

\usepackage{etoolbox}
\usepackage{keycommand}
\usepackage{xstring}
\usepackage{hyperref}
\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    urlcolor=black,
}
\usepackage{fontawesome5}
\usepackage{amsmath}
\usepackage{ragged2e}

% Load the fontspec package to set the font
\usepackage{pxfonts}
% \renewcommand\familydefault{\sfdefault} % Set the  font family to sans-serif
\usepackage[T1]{fontenc} % Use the T1 font encoding to ensure proper character rendering

\pagestyle{empty}

% -------------- README --------------
% Visit https://github.com/vgnshiyer/ASU-sparkysundevil-resume-template for comprehensive documenation.

% ------------ Utilities ------------

\def \separator {
    \textbf{\Large\textbullet}
}

\newcommand{\email}[1]{\href{mailto:#1}{#1}}%
\newcommand{\profilelink}[1]{\href{https://#1}{#1}}%

\newcommand{\isA}[1]{
    \expandafter\ifstrequal\expandafter{#1}{default}{}{a}
}

\newcommand\sectionTitle[1]{%
    \begingroup
        \vspace{0.4em}
        \textbf{\MakeUppercase{#1}}
        \vspace{0.4em}
        \hrule
        \vspace{-0.3em}
    \endgroup
}%

\newkeycommand{\introduction}[
    fullname,
    email,
    phone,
    linkedin,
    github,
    website
]{%
    \begin{center}
    \textbf{\LARGE\commandkey{fullname}} \\
    \vspace{.4em}
    \raisebox{.37ex}{
        \href{tel:\commandkey{phone}}{\commandkey{phone}}
        ~$\diamond$~
        \email{\commandkey{email}}
        ~$\diamond$~
        % \href{https://linkedin.com/in/\commandkey{linkedin}}{\faLinkedin~\commandkey{linkedin}}
        % ~$\diamond$~
        \href{https://github.com/\commandkey{github}}{github.com/\commandkey{github}}
        % ~$\diamond$~
        % \href{https://\commandkey{website}}{\commandkey{website}}
        
    }
    \end{center}
}%

% -----------------------------------

% ------------ Summary --------------
\newcommand{\summary}[1]{%
    \sectionTitle{Summary}%
    #1
}%

% -----------------------------------

% ------------ Education ------------
\newenvironment{educationSection}[1]{%
    \sectionTitle{#1}%
}%

\newkeycommand{\educationItem}[
    university,
    college,
    program,
    graduation,
    gpa,
    coursework
]{%
    {% line 1
        \bf \commandkey{university}, \commandkey{college}%
    } \hfill {%
        \emph{Expected \commandkey{graduation}}%
    } \\ % line end
    {% line 2
        \commandkey{program}%
    } \hfill GPA: \commandkey{gpa} / 4.0{% Grade field is optional (Can be left empty)
        \commandkey{grade}%
    }{} \\ % line end
    {% line 4
        Relevant coursework: \commandkey{coursework}%
    }% line end
}%

% ------------------------------------

% -------------- Skills --------------
\newenvironment{skillsSection}[1]{%
    \sectionTitle{#1}%
}%

\newkeycommand{\skillItem}[
    category,
    skills
]{%
    {%
        \bf \commandkey{category}:
    } {%
        \commandkey{skills}%
    }
}%

% ------------------------------------

% -------------- Experience -------------
\newenvironment{experienceSection}[1]{%
    \sectionTitle{#1}%
    \begin{list}{}{ % List for each highlight in the section
        \setlength{\leftmargin}{0em} % Margin within the section
    }%
        \item[]%
    }{%
    \end{list}%
}%

\newkeycommand{\experienceItem}[
    company,
    position,
    location,
    duration
]{%
    \textbf{%
        \commandkey{company},
        \commandkey{location}:
        \commandkey{position}
    } \hfill {%
        \emph{\commandkey{duration}}%
    }%
    \vspace{-0.25em}%
}%

% ---------------------------------------

% ----------------- Project -------------
\newkeycommand{\projectItem}[title, duration, keyHighlight]{%
    \textbf{%
        \commandkey{title}%
    } \hfill {%
        \emph{\commandkey{duration}}%
    } \\ {%
        \commandkey{keyHighlight}%
    }
}%

% ----------------------------------------
