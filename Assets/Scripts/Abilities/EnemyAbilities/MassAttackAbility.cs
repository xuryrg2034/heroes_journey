using System;
using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Grid;
using Unity.VisualScripting;
using UnityEngine;

namespace Abilities.EnemyAbilities
{
    [Serializable]
    public class MassAttackAbility : BaseAbility
    {
        private List<Cell> _targetCells;

        public override async UniTask Execute()
        {
            if (_tryToExecute())
            {
                await _execute();
                _reset(State.Completed);
            }
            else if (State != State.Preparing)
            {
                _prepare();   
            }
        }
        
        public override void Cancel()
        {
            if (State != State.Preparing) return;

            _reset();
        }

        private void _prepare()
        {
            State = State.Preparing;

            _targetCells = Owner.Cell
                .GetNeighbors()
                .Where((item) => item.Type != CellType.Blocked)
                .ToList();

            foreach (var cell in _targetCells)
            {
                cell.Highlite(true);
            }
        }

        private async UniTask _execute()
        {
            State = State.Execute;

            var entityList = _targetCells
                .Select(cell => cell.GetEntity())
                .Where(e => e != null && e.Health.IsDead == false)
                .ToList();

            var task = new List<UniTask>();
            
            foreach (var entity in entityList)
            {
                var tween = entity.Health.TakeDamage(1);
            
                task.Add(tween);
            }

            await UniTask.WhenAll(task);
        }

        private void _reset(State state = State.Pending)
        {
            foreach (var cell in _targetCells)
            {
                cell.Highlite(false);
            }

            _targetCells = null;
            _castCounter = 0;
            State = state;
        }
    }
}