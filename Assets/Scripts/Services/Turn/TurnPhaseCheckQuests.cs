using DG.Tweening;
using Services.Abilities;
using Services.Quest;
using UnityEngine;

namespace Services.Turn
{
    public class TurnPhaseCheckQuests : TurnPhase 
    {
        private QuestService _questService = QuestService.Instance;

        public override void StartPhase()
        {
            _preparePhase();
            _processNextPhase();
        }

        protected override void _preparePhase()
        {
            base._preparePhase();

            _turnPhases.Clear();
            _turnPhases.Enqueue(_checkQuestsPhase);
        }
        
        private void _checkQuestsPhase()
        {
            var isComplete = _questService.CheckIsCompletedActiveQuest();

            if (isComplete)
            {
                GameService.SetGameState(GameState.Finish);
            }
            else
            {
                GameService.SetGameState(GameState.WaitingForInput);
            }
        }
    }
}