using System.Linq;
using Core.Entities;
using DG.Tweening;
using Grid;
using UnityEngine;

namespace Abilities.EnemyAbilities
{
    public class MoveAbilityComponent : BaseAbility
    {
        private GameObject _self;
        
        private void Start()
        {
            // _self = GetComponent<Enemy>();
        }

        public override Tween Execute()
        {
            // var notEmptyCells = _self.Cell
            //     .GetNeighbors()
            //     .Where((item) => item.Type != CellType.Blocked)
            //     .ToList();
            // var randomCell = notEmptyCells[Random.Range(0, notEmptyCells.Count)];
            // var entityOnCell = randomCell.GetEntity();
            var sequence = DOTween.Sequence(null);
            //
            // if (entityOnCell)
            // {
            //     sequence.Join(entityOnCell.Move(_self.Cell));
            // }
            //
            // sequence.Join(_self.Move(randomCell));

            return sequence;
        }
    }
}