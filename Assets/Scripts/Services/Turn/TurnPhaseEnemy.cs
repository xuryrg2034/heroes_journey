using Services.Grid;

namespace Services.Turn
{
    public class TurnPhaseEnemy : TurnPhase 
    {
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
            var enemies = GridService.Instance.GetEnemies();
            if (enemies == null)
            {
                _processNextPhase();
                return;
            }

            foreach (var enemy in enemies)
            {
                // Есть вероятность, что цель будет уничтожена раньше
                if (enemy.Health.IsDead) continue;

                await enemy.ExecuteAbilities();
            }
            
            _processNextPhase();
        }
    }
}