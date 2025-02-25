using DG.Tweening;
using Services.Abilities;

namespace Services.Turn
{
    public class TurnPhasePlayer : TurnPhase 
    {
        private AbilitiesService _abilitiesService = AbilitiesService.Instance;

        public override void StartPhase()
        {
            _preparePhase();
            _processNextPhase();
        }

        protected override void _preparePhase()
        {
            base._preparePhase();

            _turnPhases.Clear();
            _turnPhases.Enqueue(_removeEnemiesPhase);
        }
        
        private async void _removeEnemiesPhase()
        {
            await _abilitiesService.Execute();
            _processNextPhase();
        }
    }
}