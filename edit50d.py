def sub(path, old, new, n=1):
    s=open(path,encoding='utf-8').read()
    assert old in s, (path, old[:70])
    open(path,'w',encoding='utf-8').write(s.replace(old,new,n))
n='src/realtime/view/npcLines.ts'
sub(n,"| 'vow_kept' | 'vow_broken'","| 'habit_first' | 'knack_first' | 'vow_kept' | 'vow_broken'")
sub(n,"    pack: ['В лесу появилось новое. Я внесла в опись три строки.'],","    pack: ['В лесу появилось новое. Я внесла в опись три строки.'],\n    // Task 50 §18 (design 20.10.2026): once a profile, after the first run that offered the archetype (`LineContext.last.habitOffered`).\n    habit_first: ['Повадку я записала. Теперь такие вещи тебе будут чаще попадаться на глаза'],")
sub(n,"    pack: ['Новое железо в лесу. Бери, да проверь кромку.'],","    pack: ['Новое железо в лесу. Бери, да проверь кромку.'],\n    // Task 50 §18: once a profile, after the first run that offered the knack (`LineContext.last.knackOffered`).\n    knack_first: ['Сноровка — это точить то, что уже в руке. Новое бери, когда старое тупится'],")
sub(n,"(last.questFail && line('quest_fail'))","(last.questFail && line('quest_fail')) || (npc === 'owl' && last.habitOffered && line('habit_first', true)) || (npc === 'smith' && last.knackOffered && line('knack_first', true))")
sub(n,"  last?: { won: boolean; firstWin?: boolean;","  last?: { won: boolean; habitOffered?: true; knackOffered?: true; firstWin?: boolean;")
m='src/realtime/view/metaModel.ts'
sub(m,"  last?: { won: boolean; cause?: string; row: number;","  /** `habitOffered` / `knackOffered` (task 50 §18): the run offered the archetype / the knack (the core sets them with the hearth; absent until then). */\n  last?: { habitOffered?: true; knackOffered?: true; won: boolean; cause?: string; row: number;")
