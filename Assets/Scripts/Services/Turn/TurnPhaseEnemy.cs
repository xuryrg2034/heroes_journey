using DG.Tweening;
using Services.Grid;

namespace Services.Turn
{
    public class TurnPhaseEnemy : TurnPhase 
    {
        private GridService _gridService = GridService.Instance;

        public override void Prepare()
        {
            _preparePhase();
        }
        
        protected override void _preparePhase()
        {
            base._preparePhase();

            _phases.Clear();
            _phases.Enqueue(_enemiesActionPhase);
        }
        
        private async void _enemiesActionPhase()
        {
            var enemies = _gridService.GetEnemies();
            if (enemies == null || enemies.Length == 0)
            {
                _processNextPhase();
                return;
            }

            foreach (var enemy in enemies)
            {
                // Есть вероятность, что цель будет уничтожена раньше
                if (enemy == null) continue;

                await enemy.ExecuteAbilities();
            }
            
            _processNextPhase();
        }
    }
}